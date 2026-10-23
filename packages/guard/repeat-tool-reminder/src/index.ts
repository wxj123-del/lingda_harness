/**
 * Advisory per-agent repeat-call detector. It enriches post-execute decisions
 * with logged model context without vetoing or rewriting calls. Configuration
 * and chain semantics live in the package README; rationale lives in the
 * repeat-tool-reminder Agent Note.
 * @module @deepseek-ai/dsh-repeat-tool-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'repeat-tool-reminder'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /**
   * Counts at which an identical call repeated WITHIN the turn — in any order,
   * not necessarily back to back — triggers a reminder (default `[2, 4]`).
   * The consecutive chain misses the pattern that actually wastes context in
   * long tasks: the same `read` of the same path returning several steps
   * apart, with unrelated calls in between, so its run length never
   * accumulates. An empty list disables the check.
   */
  repeatInTurnThresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
  /**
   * Turn an advisory reminder into a hard stop after this many identical calls
   * within one turn (default: unset, reminders only). A model can ignore a
   * probe; it cannot ignore an error result. Set this when a repeated identical
   * call is unambiguously waste — reading the same range, re-running the same
   * command — rather than a legitimate retry the model should judge.
   */
  blockAfterRepeats?: number
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).default([3, 5, 8]),
  repeatInTurnThresholds: z.array(z.number()).default([2, 4]),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  argumentsPreviewChars: z.number().default(500),
  blockAfterRepeats: z.number(),
})

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label is load-bearing (an unlabeled context would render as a user
 * prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'repeat-tool-reminder' }

/**
 * The gentle first-threshold reminder. Keyed to `thresholds[0]`, not a literal
 * count, so a custom first threshold keeps the gentle-then-detailed escalation.
 */
const GENTLE_REMINDER =
  'You are repeating the exact same tool call with identical arguments. '
  + 'Carefully analyze the previous result before calling again: if the task is '
  + 'not complete, try a different approach or different arguments instead of '
  + 'repeating the call.'

/**
 * First in-turn repeat reminder. Deliberately distinct from
 * {@link GENTLE_REMINDER}: the earlier result is still in the conversation, so
 * the useful advice is "reuse what you already have", not "you are looping".
 */
const IN_TURN_REPEAT_REMINDER =
  'This exact call already ran earlier in this turn and its result is still in '
  + 'the conversation. Reuse that result instead of fetching it again: re-read '
  + 'only when an edit or write changed the file, and otherwise continue from '
  + 'the content you already have.'

/** The later in-turn reminder naming the call, how often it ran, and the arguments. */
function inTurnRepeatReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated identical call within one turn:\n'
    + `- tool: ${toolName}\n`
    + `- calls_this_turn: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'Each repeat costs context without adding evidence. Use the result you '
    + 'already received, or change the arguments, or finish if the evidence is '
    + 'sufficient.'
}

/** The detailed later-threshold reminder naming the tool, the run length, and the canonical arguments. */
function detailedReminder(toolName: string, count: number, canonicalArguments: string): string {
  return 'Repeated tool call detected:\n'
    + `- tool: ${toolName}\n`
    + `- consecutive_calls: ${count}\n`
    + `- arguments: ${canonicalArguments}\n`
    + 'The repeated calls are not making progress. Do not call this tool with '
    + 'these exact arguments again. Inspect the latest result and choose a '
    + 'different action, different arguments, or finish the task if enough '
    + 'evidence has been gathered.'
}

/**
 * Deep key-sort of a parsed-JSON value so two argument objects that differ
 * only in property order canonicalize identically. Arguments reach the guard
 * as the loop's `JSON.parse` output (or its raw-string fallback for malformed
 * argument JSON), so JSON's value domain is the whole input domain — no
 * bigint, cycle, or `undefined` handling exists because no input path can
 * produce them.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/** Canonical string form of a call's arguments: deep key-sort, then stringify. */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Head-truncate the canonical arguments for quoting in the detailed reminder,
 * marking how much was omitted. Bounds only the model-visible text — the
 * chain key always uses the full canonical string.
 */
function previewArguments(canonical: string, cap: number): string {
  if (canonical.length <= cap) return canonical
  return `${canonical.slice(0, cap)}… (+${canonical.length - cap} more chars)`
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending (the escalation rule reads `thresholds[0]` as the gentle tier, so
 * order is normalized here, once).
 */
function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('repeat-tool-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid threshold ${value} — every threshold must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * Fold every reminder onto the downstream decision, preserving its variant.
 * @param reminders - this attempt's reminders, in delivery order.
 * @param downstream - the decision later listeners produced.
 * @returns the same decision carrying the reminders ahead of its own contexts.
 */
function foldReminders(reminders: UserMessage[], downstream: PostToolDecision): PostToolDecision {
  const contexts = [...reminders, ...downstream.additionalContexts ?? []]
  return downstream.kind === 'block'
    ? { kind: 'block', feedback: downstream.feedback, additionalContexts: contexts }
    : { ...downstream, additionalContexts: contexts }
}

/**
 * Build one reminder message for the model.
 * @param toolName - the repeated call's tool.
 * @param count - how many times it has now run.
 * @param text - the reminder body.
 * @returns the message, stamped with the guard's plugin source.
 */
function notice(toolName: string, count: number, text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: `${toolName} × ${count}` },
  })
}

/** One agent's consecutive-repeat chain: the last tracked call's identity key and its run length. */
interface Chain {
  key: string
  count: number
}

/**
 * Validate the in-turn repeat thresholds. Unlike `thresholds`, an empty list is
 * legal here: it is how a deployment turns this check off without also
 * disabling the consecutive one.
 * @param values - configured repeat counts.
 * @returns the same values, ascending.
 */
function validateInTurnThresholds(values: number[]): number[] {
  for (const value of values) {
    if (!Number.isInteger(value) || value < 2) {
      throw new Error(`repeat-tool-reminder: invalid repeatInTurnThresholds entry ${value} — every entry must be an integer >= 2`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('repeat-tool-reminder: `repeatInTurnThresholds` must not contain duplicates')
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `thresholds` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the fields are set after validation.
  const thresholds = validateThresholds(config.thresholds as number[])
  const thresholdSet = new Set(thresholds)
  const inTurnThresholds = validateInTurnThresholds(config.repeatInTurnThresholds as number[])
  const inTurnThresholdSet = new Set(inTurnThresholds)
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)
  const argumentsPreviewChars = config.argumentsPreviewChars as number
  if (!Number.isInteger(argumentsPreviewChars) || argumentsPreviewChars < 1) {
    throw new Error(`repeat-tool-reminder: invalid argumentsPreviewChars ${argumentsPreviewChars} — must be an integer >= 1`)
  }
  const blockAfterRepeats = config.blockAfterRepeats
  if (blockAfterRepeats !== undefined && (!Number.isInteger(blockAfterRepeats) || blockAfterRepeats < 2)) {
    throw new Error(`repeat-tool-reminder: invalid blockAfterRepeats ${String(blockAfterRepeats)} — must be an integer >= 2`)
  }

  const chains = new WeakMap<Agent, Chain>()
  /**
   * Per-agent counts of every tracked identity key seen since the last user
   * message. `chains` only tracks a back-to-back run, which never accumulates
   * across the interleaved calls a long task is full of; this map is what
   * catches "the same read again, ten steps later". It is bounded by the
   * number of distinct calls one turn makes.
   */
  const inTurnCounts = new WeakMap<Agent, Map<string, number>>()

  /** Whether a tool participates in the chain (untracked calls are transparent: they neither count nor reset). */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(pattern => pattern.test(toolName))) return false
    return !excludePatterns.some(pattern => pattern.test(toolName))
  }

  /**
   * Advance the calling agent's chain for one attempt and return the reminder
   * to deliver, if this attempt's run length hits a configured threshold.
   * Counting happens here — in post-execute — because denied calls also flow
   * through this waterfall (`ToolRuntime.execute` routes a deny through the
   * same pipeline), and a model hammering a denied call is exactly the loop
   * worth breaking.
   */
  /**
   * Advance both counters for one attempt and return the reminders to deliver.
   *
   * The consecutive chain and the in-turn tally answer different questions. The
   * chain catches a model hammering one call without moving; the tally catches
   * the same call coming back after unrelated work, which is the shape that
   * actually wastes context in a long task. Both count denied calls too, because
   * a deny flows through this same waterfall and a model repeating a denied call
   * is exactly the loop worth breaking.
   * @param exec - the finished attempt, including the agent that issued it.
   * @returns the reminders to fold onto the result (consecutive first) and, when
   *   `blockAfterRepeats` is configured and reached, the call count that tripped it.
   */
  function observe(exec: ToolExecution): { reminders: UserMessage[]; blockedAt?: number } {
    // A direct `ctx.tools.execute()` caller has no model to remind and no id
    // to key on; only agent-loop calls participate.
    if (!exec.agent) return { reminders: [] }
    if (!tracked(exec.name)) return { reminders: [] }
    const canonical = canonicalize(exec.arguments)
    const key = JSON.stringify([exec.name, canonical])
    const reminders: UserMessage[] = []

    const chain = chains.get(exec.agent)
    const count = chain !== undefined && chain.key === key ? chain.count + 1 : 1
    chains.set(exec.agent, { key, count })
    if (thresholdSet.has(count)) {
      const text = count === thresholds[0]
        ? GENTLE_REMINDER
        : detailedReminder(exec.name, count, previewArguments(canonical, argumentsPreviewChars))
      reminders.push(notice(exec.name, count, text))
    }

    let blockedAt: number | undefined
    if (inTurnThresholdSet.size > 0 || blockAfterRepeats !== undefined) {
      let counts = inTurnCounts.get(exec.agent)
      if (counts === undefined) {
        counts = new Map()
        inTurnCounts.set(exec.agent, counts)
      }
      const calls = (counts.get(key) ?? 0) + 1
      counts.set(key, calls)
      if (inTurnThresholdSet.has(calls)) {
        const text = calls === inTurnThresholds[0]
          ? IN_TURN_REPEAT_REMINDER
          : inTurnRepeatReminder(exec.name, calls, previewArguments(canonical, argumentsPreviewChars))
        reminders.push(notice(exec.name, calls, text))
      }
      // `>=` rather than equality: past the limit the call stays blocked, so a
      // model that retries anyway keeps getting the same explicit refusal
      // instead of silently succeeding on the next attempt.
      if (blockAfterRepeats !== undefined && calls >= blockAfterRepeats) blockedAt = calls
    }
    return { reminders, ...(blockedAt === undefined ? {} : { blockedAt }) }
  }

  // Observe-and-enrich, never veto: count first (state advances regardless of
  // the downstream outcome), DELEGATE so a later listener can still block or
  // replace, then fold the reminder onto whatever came back — additionalContexts
  // rides both decision variants, so a blocked call still gets the nudge.
  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const { reminders, blockedAt } = observe(exec)
    const downstream = await next()
    if (blockedAt !== undefined) {
      // The call already ran, so its work is not undone; what stops here is the
      // next identical attempt. Replacing the result with an error is the only
      // lever a post-execute hook has, and it is the right one: the model sees
      // a refusal it must act on rather than another success it can ignore.
      const feedback = {
        type: 'text' as const,
        text: `Blocked: this exact ${exec.name} call has already run ${String(blockedAt)} times in this turn. `
          + 'Its result is still in the conversation. Change approach or finish the task — repeating it again will be blocked too.',
      }
      return { kind: 'block', feedback: [feedback], ...(reminders.length > 0 ? { additionalContexts: reminders } : {}) }
    }
    if (reminders.length === 0) return downstream
    return foldReminders(reminders, downstream)
  })

  // A user interjection changes the context; repetition across it is not a
  // loop, and the in-turn tally is scoped to one turn by definition. Pure
  // reset hook: always delegates (attaching nothing, vetoing nothing).
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) {
      chains.delete(agent)
      inTurnCounts.delete(agent)
    }
    return next()
  })
}
