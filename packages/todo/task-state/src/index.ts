/**
 * Durable task state for long-running work: a last-write-wins `task` projection,
 * the model-facing `task_update` tool, a compact per-turn recitation card, and
 * automatic command evidence recorded from settled tool results.
 *
 * The card is injected as a plugin-sourced user message at the start of every
 * top-level turn, so the objective, acceptance criteria, and uncovered gaps are
 * restated after compaction or a long tool chain instead of living only in an
 * earlier summary.
 * @module @deepseek-ai/dsh-task-state
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage, HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: the `tokenUsage` projection-key merge owned by the token meter.
import type {} from '@deepseek-ai/dsh-token-meter'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  applyTaskPatch,
  appendAutoEvidence,
  isEvidenceKind,
  isEvidenceStatus,
  isTaskStatus,
  renderTaskCard,
  reverifiableCommands,
  taskView,
} from './state.ts'
import type { CardProgress, EvidenceInput, FileFact, ShellFact, TaskPatch } from './state.ts'
import type { TaskState } from './types.ts'

export type * from './types.ts'
export {
  applyTaskPatch,
  isVerifiedEvidence,
  renderTaskCard,
  taskView,
  uncoveredAcceptance,
  unverifiedAcceptance,
} from './state.ts'

/** Plugin name. */
export const name = 'task-state'
/** Services the plugin reads: tool registry, projection registry, prompt registry. */
export const inject = ['tools', 'sessionProjections', 'systemPrompt']

/** Deployment policy for the task domain. Every field carries a schema default. */
export interface Config {
  /** Inject the compact task card at the start of every top-level turn. */
  injectTaskCard?: boolean
  /** Record settled bash/pwsh results as automatic evidence while a task is active. */
  recordCommandEvidence?: boolean
  /**
   * Require observed evidence before a task may be marked succeeded: an
   * automatic record, or a command the session log shows exiting zero. When
   * false, any passing evidence record covers a criterion.
   */
  requireVerifiedEvidence?: boolean
  /**
   * Re-run every verified command immediately before a task may be marked
   * succeeded. The re-run goes through the tool pipeline, so approval, sandbox,
   * timeout policy, and logging all apply.
   */
  reverifyEvidence?: boolean
  /** Wall-clock limit for one re-verification run. */
  reverifyTimeoutMs?: number
  /** Upper bound on distinct commands re-run for one completion attempt. */
  maxReverifyCommands?: number
}

/** The same policy with every schema default applied, as `apply` uses it. */
type ResolvedConfig = Required<Config>

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  injectTaskCard: z.boolean().default(true),
  recordCommandEvidence: z.boolean().default(true),
  requireVerifiedEvidence: z.boolean().default(true),
  reverifyEvidence: z.boolean().default(false),
  reverifyTimeoutMs: z.number().default(300_000),
  maxReverifyCommands: z.number().default(8),
})

const EVIDENCE_SCHEMA = zod.object({
  id: zod.string().min(1),
  kind: zod.enum(['command', 'test', 'file', 'manual']),
  ref: zod.string().min(1),
  status: zod.enum(['pass', 'fail', 'unknown']),
  acceptance: zod.array(zod.number().int().positive()),
  at: zod.number(),
  auto: zod.literal(true).optional(),
}).strict()

const DECISION_SCHEMA = zod.object({ text: zod.string(), at: zod.number() }).strict()

const TASK_SCHEMA = zod.object({
  revision: zod.number().int().positive(),
  objective: zod.string(),
  status: zod.enum(['active', 'blocked', 'succeeded', 'cancelled']),
  acceptance: zod.array(zod.string()),
  evidence: zod.array(EVIDENCE_SCHEMA),
  decisions: zod.array(DECISION_SCHEMA),
  handoff: zod.string().optional(),
  createdAt: zod.number(),
  updatedAt: zod.number(),
}).strict()

const taskProjectionSchema: ZodType<TaskState | null> = zod.union([TASK_SCHEMA, zod.null()])

const TASK_GUIDANCE =
  'Use task_update for multi-step work that must survive a long session. Create one task with a '
  + 'concrete objective and verifiable acceptance criteria before the first substantive step. '
  + 'Record evidence as you go: evidence entries name exactly what was run or read, and their '
  + '`acceptance` indices claim which criteria they demonstrate. Marking the task `succeeded` is '
  + 'rejected while any acceptance criterion still lacks passing evidence, so complete the work and '
  + 'its evidence together. Use `handoff` before a long pause or budget stop, and `decision` to '
  + 'record a choice and its reason. The current task is restated at the start of every turn.'

/** Read the current snapshot through the projection registry. */
function currentTask(ctx: Context, session: Session): TaskState | null {
  return ctx.sessionProjections.stateOf(session, 'task') ?? null
}

/** Append one whole snapshot; every mutation is a complete replacement. */
function writeTask(session: Session, task: TaskState | null): void {
  session.append('task/state', { task }, { ignorable: true })
}

/** Convert model-supplied evidence objects into store inputs. */
function evidenceInputs(raw: readonly {
  kind: string
  ref: string
  status: string
  acceptance?: number[]
}[]): EvidenceInput[] {
  return raw.map((entry) => {
    if (!isEvidenceKind(entry.kind)) {
      throw new Error(`unknown evidence kind ${JSON.stringify(entry.kind)}`)
    }
    if (!isEvidenceStatus(entry.status)) {
      throw new Error(`unknown evidence status ${JSON.stringify(entry.status)}`)
    }
    return {
      kind: entry.kind,
      ref: entry.ref,
      status: entry.status,
      ...entry.acceptance === undefined ? {} : { acceptance: entry.acceptance },
    }
  })
}

/** The exact command text of one settled shell execution, when the arguments carry one. */
function commandText(argumentsValue: unknown): string | undefined {
  if (typeof argumentsValue !== 'object' || argumentsValue === null) return undefined
  const command = (argumentsValue as Record<string, unknown>)['command']
  return typeof command === 'string' && command.trim().length > 0 ? command.trim() : undefined
}

/** Exit code of a settled foreground shell result, when the value carries one. */
function exitCodeOf(result: ToolExecutionResult): number | null | undefined {
  if (result.isError) return undefined
  const value = result.value
  if (typeof value !== 'object' || value === null) return undefined
  const exitCode = (value as Record<string, unknown>)['exitCode']
  return typeof exitCode === 'number' || exitCode === null ? exitCode : undefined
}


/** Exit code recoverable from a successful result's rendered text, when the value was replaced. */
function renderedExitCode(content: readonly ContentBlock[]): number | undefined {
  const text = content.map(block => block.type === 'text' ? block.text : '').join('\n')
  if (/\n\[killed by signal: [^\]\n]+\]$/.test(text)) return undefined
  const match = /\n\[exit code: (\d+)\]$/.exec(text)
  return match?.[1] === undefined ? 0 : Number(match[1])
}

/**
 * Exit code carried by a settled `tool/result` event. The executor's canonical
 * value is not on the durable record, so the rendered text is the only source:
 * the shell renderer appends `[exit code: N]` for a non-zero exit and
 * `[killed by signal: X]` for a kill, and appends nothing on a clean exit. An
 * errored result carries no usable code.
 * @param message - the settled tool-result message.
 * @returns the exit code, or undefined when the run did not complete normally.
 */
function loggedExitCode(message: { content: readonly ContentBlock[] }): number | undefined {
  const block = message.content[0]
  if (block?.type !== 'tool-result') return undefined
  if (block.isError === true) return undefined
  const text = block.content.map(part => part.type === 'text' ? part.text : '').join('\n')
  if (/\n\[killed by signal: [^\]\n]+\]$/.test(text)) return undefined
  const match = /\n\[exit code: (\d+)\]$/.exec(text)
  // No marker is a clean exit: the renderer omits it precisely when the code is 0.
  return match?.[1] === undefined ? 0 : Number(match[1])
}

/** Tools that observe a file's current content, with the argument naming the path. */
const FILE_READERS: Readonly<Record<string, string>> = {
  read: 'file_path',
  grep: 'path',
  glob: 'pattern',
}

/**
 * Recover every successful file read from the session log: the tool, the path it
 * was asked for. An errored result never counts, so a missing or unreadable file
 * cannot back a `file` evidence record.
 * @param session - the owning agent session.
 * @returns observed reads, in log order.
 */
function fileFacts(session: Session): FileFact[] {
  const requests = new Map<string, { name: string; path: string }>()
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/call') continue
    const key = FILE_READERS[event.data.name]
    if (key === undefined) continue
    let args: unknown
    try {
      args = JSON.parse(event.data.arguments)
    } catch {
      continue
    }
    if (typeof args !== 'object' || args === null) continue
    const path = (args as Record<string, unknown>)[key]
    if (typeof path === 'string' && path.trim().length > 0) {
      requests.set(String(event.data.callId), { name: event.data.name, path: path.trim() })
    }
  }

  const facts: FileFact[] = []
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    if (block?.type !== 'tool-result' || block.isError === true) continue
    const observed = requests.get(String(event.data.message.source.callId))
    if (observed === undefined) continue
    facts.push(observed)
  }
  return facts
}

/**
 * Recover every successful shell invocation from the session log: the model's
 * exact command argument and the executor's reported exit code. Only the
 * terminal `tool/result` of a call whose arguments carry a command counts, so a
 * record naming a command the session never ran stays unverified.
 * @param session - the owning agent session.
 * @returns observed shell facts, in log order.
 */
function shellFacts(session: Session): ShellFact[] {
  const commands = new Map<string, { name: string; command: string; arguments: Record<string, unknown> }>()
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/call') continue
    if (event.data.name !== 'bash' && event.data.name !== 'pwsh') continue
    let args: unknown
    try {
      args = JSON.parse(event.data.arguments)
    } catch {
      continue
    }
    const command = commandText(args)
    if (command !== undefined) {
      commands.set(String(event.data.callId), {
        name: event.data.name,
        command,
        arguments: args as Record<string, unknown>,
      })
    }
  }

  const facts: ShellFact[] = []
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'tool/result') continue
    const callId = event.data.message.source.callId
    const observed = commands.get(String(callId))
    if (observed === undefined) continue
    const exitCode = loggedExitCode(event.data.message)
    if (exitCode === undefined) continue
    facts.push({
      name: observed.name,
      command: observed.command,
      exitCode,
      arguments: observed.arguments,
    })
  }
  return facts
}

/** One-line summary carried on the injected card's collapsed row. */
function cardSummary(task: TaskState): string {
  const gaps = task.acceptance.length === 0
    ? 0
    : task.acceptance.filter((_text, index) => !task.evidence.some(
      record => record.status === 'pass' && record.acceptance.includes(index + 1),
    )).length
  return boundContextSummary(
    `task ${task.status}: ${String(task.acceptance.length)} acceptance, ${String(gaps)} uncovered`,
  )
}

/**
 * Re-run every command that currently backs the task, through the tool pipeline.
 * Two invariants make this safe: only commands the log already observed are
 * re-run (a model cannot invent one at completion time), and every run goes
 * through `ctx.tools.execute` so approval, sandbox, timeout policy, and logging
 * apply exactly as they did the first time. The run itself lands a `tool/result`,
 * so the shell observer records it as fresh automatic evidence.
 * @param ctx - plugin context supplying the tool registry.
 * @param exec - the `task_update` execution whose identity and signal the re-runs inherit.
 * @param task - the tentative snapshot whose evidence names the commands.
 * @param config - resolved re-verification policy.
 */
async function reverifyCommands(
  ctx: Context,
  exec: ToolRunContext,
  task: TaskState,
  config: ResolvedConfig,
): Promise<void> {
  if (exec.agent === undefined) return
  const commands = reverifiableCommands(task, shellFacts(exec.agent.session), { latestOnly: true })
  if (commands.length === 0) return
  if (commands.length > config.maxReverifyCommands) {
    throw new HarnessError(
      `re-verification covers ${String(commands.length)} commands, above the configured limit of `
      + `${String(config.maxReverifyCommands)}; consolidate the evidence commands`,
      'TASK_REVERIFY_TOO_MANY',
    )
  }
  for (const [index, item] of commands.entries()) {
    if (ctx.tools.get(item.name, exec.agent) === undefined) {
      throw new HarnessError(
        `re-verification needs tool "${item.name}", which this deployment does not provide`,
        'TASK_REVERIFY_UNAVAILABLE',
      )
    }
    const timeout = AbortSignal.timeout(config.reverifyTimeoutMs)
    const signal = AbortSignal.any([exec.signal, timeout])
    let result: ToolExecutionResult
    try {
      result = await ctx.tools.execute({
        callId: ToolCallId(`reverify-${String(exec.callId)}-${String(index)}`),
        rootCallId: exec.rootCallId,
        // Nested identity: PTC-mode deployments deny a model-direct native name.
        parent: exec.token,
        name: item.name,
        arguments: item.arguments ?? { command: item.command },
        agent: exec.agent,
        signal,
      })
    } catch (error: unknown) {
      if (timeout.aborted) {
        throw new HarnessError(
          `re-verification timed out after ${String(config.reverifyTimeoutMs)}ms: ${item.command}`,
          'TASK_REVERIFY_TIMEOUT',
        )
      }
      throw error
    }
    // The registry may replace a result's canonical value with a bounded
    // projection (spill or clipping), so the rendered text is the fallback the
    // log path already relies on. A missing code from both sources is unknown,
    // not a pass: fail closed rather than claim a success nothing proved.
    const exitCode = exitCodeOf(result) ?? (result.isError ? undefined : renderedExitCode(result.content))
    if (result.isError || exitCode === undefined || exitCode !== 0) {
      // A tool body rejection reaches this function as an error result, so the
      // timeout is recognized here as well as in the catch above.
      if (timeout.aborted) {
        throw new HarnessError(
          `re-verification timed out after ${String(config.reverifyTimeoutMs)}ms: ${item.command}`,
          'TASK_REVERIFY_TIMEOUT',
        )
      }
      throw new HarnessError(
        `re-verification failed for "${item.command}" (exit ${exitCode === undefined ? 'unknown' : String(exitCode)}); `
        + 'the criterion is no longer backed by a live pass, so the task stays active',
        'TASK_REVERIFY_FAILED',
      )
    }
  }
}

/**
 * Install the projection, guidance section, tool, recitation listener, and
 * automatic evidence observer.
 * @param ctx - plugin context; every listener is disposed with its fiber.
 * @param config - deployment policy for recitation and automatic evidence.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    injectTaskCard: config.injectTaskCard ?? true,
    recordCommandEvidence: config.recordCommandEvidence ?? true,
    requireVerifiedEvidence: config.requireVerifiedEvidence ?? true,
    reverifyEvidence: config.reverifyEvidence ?? false,
    reverifyTimeoutMs: config.reverifyTimeoutMs ?? 300_000,
    maxReverifyCommands: config.maxReverifyCommands ?? 8,
  }
  if (!Number.isSafeInteger(resolved.reverifyTimeoutMs) || resolved.reverifyTimeoutMs < 1) {
    throw new TypeError('task-state: reverifyTimeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxReverifyCommands) || resolved.maxReverifyCommands < 1) {
    throw new TypeError('task-state: maxReverifyCommands must be a positive safe integer')
  }
  // Re-verification is the strict gate's second phase: running it while the
  // gate accepts asserted evidence would imply a check that never happens.
  if (resolved.reverifyEvidence && !resolved.requireVerifiedEvidence) {
    throw new TypeError('task-state: reverifyEvidence requires requireVerifiedEvidence')
  }

  ctx.sessionProjections.register<'task', TaskState | null>({
    key: 'task',
    stateVersion: 1,
    stateSchema: taskProjectionSchema,
    init: () => null,
    apply: (state, event) => (event.type === 'task/state' ? event.data.task : state),
    wire: { viewSchema: taskProjectionSchema, view: state => state },
  })

  ctx.systemPrompt.section({
    name: 'tool:task',
    order: 2450,
    text: TASK_GUIDANCE,
  })

  ctx.tools.register(defineTool({
    name: 'task_update',
    description:
      'Create or update the durable task for this session. Call it once with an objective and '
      + 'verifiable acceptance criteria, record evidence with the indices it covers, and mark the '
      + 'task succeeded only when every criterion has passing evidence. Every call returns the '
      + 'complete task including uncovered acceptance indices.',
    parameters: {
      objective: {
        type: 'string',
        description: 'User objective in their own terms; required to create the first task.',
      },
      acceptance: {
        type: 'array',
        items: { type: 'string' },
        description: 'Acceptance criteria to append; existing criteria keep their indices.',
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              required: true,
              enum: ['command', 'test', 'file', 'manual'],
            },
            ref: {
              type: 'string',
              required: true,
              description: 'Exact command, path, or short description of what was run or read.',
            },
            status: { type: 'string', required: true, enum: ['pass', 'fail', 'unknown'] },
            acceptance: {
              type: 'array',
              items: { type: 'integer' },
              description: '1-based acceptance indices this record demonstrates.',
            },
          },
        },
        description: 'Evidence records to append.',
      },
      decision: { type: 'string', description: 'One decision with its rationale to append.' },
      handoff: { type: 'string', description: 'How to resume this task later.' },
      status: {
        type: 'string',
        enum: ['active', 'blocked', 'succeeded', 'cancelled'],
        description: 'Replacement lifecycle status.',
      },
    },
    output: {
      // The task view is a whole snapshot whose shape `taskView` owns; the
      // registry only needs a JSON object root here.
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) {
        throw new Error('task_update requires an owning agent session')
      }
      const patch: TaskPatch = {
        ...args.objective === undefined ? {} : { objective: args.objective },
        ...args.acceptance === undefined ? {} : { acceptance: args.acceptance },
        ...args.evidence === undefined ? {} : { evidence: evidenceInputs(args.evidence) },
        ...args.decision === undefined ? {} : { decision: args.decision },
        ...args.handoff === undefined ? {} : { handoff: args.handoff },
        ...args.status === undefined ? {} : { status: args.status },
      }
      if (patch.status !== undefined && !isTaskStatus(patch.status)) {
        throw new Error(`unknown task status ${JSON.stringify(patch.status)}`)
      }
      const session = exec.agent.session
      const policy = {
        requireVerifiedEvidence: resolved.requireVerifiedEvidence,
        shellFacts: resolved.requireVerifiedEvidence ? shellFacts(session) : [],
        fileFacts: resolved.requireVerifiedEvidence ? fileFacts(session) : [],
      }

      // Phase 1: a tentative apply validates coverage and names the commands to
      // re-run. Nothing is written, so a rejection here reaches the model with
      // exactly the reason the gate produced.
      const tentative = applyTaskPatch(currentTask(ctx, session), patch, Date.now(), policy)

      // Phase 2: prove each backing command still passes. Re-runs land their own
      // `tool/result`, and the shell observer may append automatic evidence to
      // the snapshot, which is why phase 3 re-reads instead of reusing `current`.
      if (resolved.reverifyEvidence && tentative.status === 'succeeded') {
        await reverifyCommands(ctx, exec, tentative, resolved)
      }

      // Phase 3: re-read and re-apply so evidence written during phase 2 is not
      // overwritten by a stale snapshot.
      const next = applyTaskPatch(currentTask(ctx, session), patch, Date.now(), {
        requireVerifiedEvidence: resolved.requireVerifiedEvidence,
        shellFacts: resolved.requireVerifiedEvidence ? shellFacts(session) : [],
        fileFacts: resolved.requireVerifiedEvidence ? fileFacts(session) : [],
      })
      writeTask(session, next)
      return taskView(next)
    },
    presentCall: args => ({ card: 'generic', title: 'Update task', kind: 'other', rawInput: args }),
  }))

  /**
   * Session-cumulative usage from the token meter, when that plugin is mounted.
   * The wire view is the flat totals object; `stateOf` would return the fold's
   * internal `{ totals, last }` shape instead.
   */
  function cardProgress(session: Session): CardProgress | undefined {
    const values = ctx.sessionProjections.snapshot(session, ['tokenUsage']).values
    const usage = values['tokenUsage'] as Partial<CardProgress> | undefined
    if (usage === undefined) return undefined
    return {
      uncachedInputTokens: usage.uncachedInputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
    }
  }

  /** Highest task revision whose card each session has already injected. */
  const injectedRevision = new WeakMap<Session, number>()

  ctx.on('agent/pre-step', async ({ agent, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (!resolved.injectTaskCard || decision.kind === 'reject') return decision
    const task = currentTask(ctx, agent.session)
    if (task === null) return decision
    // The first step of a turn always restates the task; a later step restates it
    // only when the task changed since the last card, which is what makes a
    // mid-turn creation or update visible in the same turn.
    const known = injectedRevision.get(agent.session)
    if (step !== 1 && known !== undefined && known === task.revision) return decision
    injectedRevision.set(agent.session, task.revision)
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: renderTaskCard(task, cardProgress(agent.session)) }],
        source: { kind: 'plugin', plugin: 'task-state', form: 'notice', summary: cardSummary(task) },
      })],
    }
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (!resolved.recordCommandEvidence || exec.agent === undefined) return downstream
    if (exec.name !== 'bash' && exec.name !== 'pwsh') return downstream
    if (downstream.kind === 'block') return downstream
    const task = currentTask(ctx, exec.agent.session)
    if (task === null || task.status !== 'active') return downstream
    const ref = commandText(exec.arguments)
    if (ref === undefined) return downstream
    const exitCode = exitCodeOf(result)
    if (exitCode === undefined) return downstream
    const record: EvidenceInput = {
      kind: 'command',
      ref: ref.length > 180 ? `${ref.slice(0, 179)}…` : ref,
      status: result.isError || exitCode !== 0 ? 'fail' : 'pass',
    } as EvidenceInput
    writeTask(exec.agent.session, appendAutoEvidence(task, record, Date.now()))
    return downstream
  })
}
