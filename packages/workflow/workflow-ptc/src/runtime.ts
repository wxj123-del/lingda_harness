/**
 * Workflow VM hooks, child callbacks, ordinary concurrency limits and result serialization.
 * PTC owns process confinement and cancellation. Fatal hook and provider failures propagate
 * through combinators; ordinary child failures and stage errors become per-item nulls.
 * @module @deepseek-ai/dsh-workflow-ptc/runtime
 */

import * as vm from 'node:vm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { assertObjectJsonSchema, JsonSchemaError } from '@deepseek-ai/dsh-tools'
import type { ObjectJsonSchema, ToolRestriction } from '@deepseek-ai/dsh-tools'
import { isFatalWorkflowError, WorkflowError } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowNodeEndInfo,
  WorkflowNodeStartInfo,
  WorkflowMeta,
  WorkflowResult,
} from '@deepseek-ai/dsh-workflow'
import { materializeFromRealm, MaterializeError, renderThrown } from './realm.ts'
import type { ChildHandle, ChildPort, WorkerLimits, WorkflowHttpPort, WorkflowHttpRequest, WorkflowHttpResponse } from './types.ts'

/** The observers the execution reports progress through (the session posts them to the host). */
export interface ExecutionObserver {
  phase(title: string): void
  log(message: string): void
  agentStart(info: WorkflowAgentInfo): void
  agentEnd(info: WorkflowAgentEndInfo): void
  nodeStart(info: WorkflowNodeStartInfo): void
  nodeEnd(info: WorkflowNodeEndInfo): void
}

/** The `agent()` options the script may pass; everything else rejects loud. */
const SUPPORTED_AGENT_OPTIONS = new Set(['label', 'phase', 'schema', 'provider', 'model', 'toolFilter'])
/** Deferred Claude Code options we name explicitly in the rejection message. */
const DEFERRED_AGENT_OPTIONS = new Set(['effort', 'isolation', 'agentType'])

/** Flatten a child's final output blocks to text (the non-schema `agent()` result). */
function outputText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** A short display label derived from the prompt when the script passes none. */
function defaultLabel(prompt: string): string {
  const newline = prompt.indexOf('\n')
  const line = newline === -1 ? prompt : prompt.slice(0, newline)
  return line.length <= 48 ? line : `${line.slice(0, 47)}…`
}

/**
 * One script execution inside the confined Node process. The host owns
 * cancellation and cleanup of any dropped child work.
 */
export class WorkflowExecution {
  /** 1-based count of `agent()` calls started (the `agentsStarted` result field). */
  private started = 0
  private activeSlots = 0
  private readonly slotWaiters: (() => void)[] = []
  private currentPhase: string | undefined
  private readonly liveNodes = new Map<string, WorkflowNodeStartInfo>()
  private readonly context: vm.Context
  private readonly compiled: vm.Script

  constructor(
    meta: WorkflowMeta,
    body: string,
    args: unknown,
    private readonly limits: WorkerLimits,
    private readonly observer: ExecutionObserver,
    private readonly children: ChildPort,
    private readonly http: WorkflowHttpPort,
    private readonly nodeAudit: boolean,
  ) {
    // The host parses this same wrapper before publishing a run.
    try {
      this.compiled = new vm.Script(`(async () => {\n${body}\n})()`, {
        filename: `workflow:${meta.name}`,
        lineOffset: -1,
      })
    } catch (error: unknown) {
      throw new WorkflowError(`workflow script does not parse: ${String(error)}`, 'SCRIPT_PARSE', { cause: error })
    }

    this.context = vm.createContext({}, { name: `workflow:${meta.name}` })

    const globals: Record<string, unknown> = {
      agent: (prompt: unknown, opts?: unknown) => this.contain(this.agent(prompt, opts)),
      parallel: (thunks: unknown) => this.contain(this.parallel(thunks)),
      pipeline: (items: unknown, ...stages: unknown[]) => this.contain(this.pipeline(items, stages)),
      httpRequest: (request: unknown) => this.contain(this.httpRequest(request)),
      phase: (title: unknown) => { this.phase(title) },
      log: (message: unknown) => { this.log(message) },
      // PTC has already copied these inputs through its JSON channel.
      args,
    }
    if (this.nodeAudit) {
      ;(this.context as Record<string, unknown>).nodeStart = Object.freeze((nodeId: unknown, label: unknown, input: unknown, retryCount?: unknown) => {
        this.nodeStart(nodeId, label, input, retryCount)
      })
      ;(this.context as Record<string, unknown>).nodeEnd = Object.freeze((nodeId: unknown, label: unknown, status: unknown, output?: unknown, error?: unknown, retryCount?: unknown) => {
        this.nodeEnd(nodeId, label, status, output, error, retryCount)
      })
    }
    for (const [key, value] of Object.entries(globals)) {
      // Data properties on the contextified global; frozen shape not required —
      // a script overwriting its own hooks only sabotages itself.
      ;(this.context as Record<string, unknown>)[key] = typeof value === 'function' ? Object.freeze(value) : value
    }
  }

  /** The host-controlled `httpRequest()` hook. */
  private async httpRequest(rawRequest: unknown): Promise<WorkflowHttpResponse> {
    let request: unknown
    try {
      request = materializeFromRealm(rawRequest, 'httpRequest() request')
    } catch (error: unknown) {
      /* v8 ignore next -- defensive rethrow: materializeFromRealm owns the error class. */
      if (!(error instanceof MaterializeError)) throw error
      throw new WorkflowError(`httpRequest() request must be plain JSON data — ${error.message}`, 'INVALID_ARGUMENT', { cause: error })
    }
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      throw new WorkflowError('httpRequest() requires an object request', 'INVALID_ARGUMENT')
    }
    const record = request as Record<string, unknown>
    const unknown = Object.keys(record).find(key => !['url', 'method', 'body', 'credential'].includes(key))
    if (unknown !== undefined) throw new WorkflowError(`httpRequest() has unknown field "${unknown}"`, 'INVALID_ARGUMENT')
    if (typeof record.url !== 'string' || record.url.trim() === '') throw new WorkflowError('httpRequest() url must be a non-empty string', 'INVALID_ARGUMENT')
    if (typeof record.method !== 'string' || record.method.trim() === '') throw new WorkflowError('httpRequest() method must be a non-empty string', 'INVALID_ARGUMENT')
    if (record.credential !== undefined && (typeof record.credential !== 'string' || record.credential.trim() === '')) {
      throw new WorkflowError('httpRequest() credential must be a non-empty string when provided', 'INVALID_ARGUMENT')
    }
    const normalized: WorkflowHttpRequest = {
      url: record.url,
      method: record.method.toUpperCase(),
      ...Object.hasOwn(record, 'body') ? { body: record.body } : {},
      ...record.credential === undefined ? {} : { credential: record.credential },
    }
    try {
      return await this.http.request(normalized)
    } catch (error: unknown) {
      if (isFatalWorkflowError(error)) throw error
      throw new WorkflowError(`httpRequest() failed: ${renderThrown(error)}`, 'HTTP_REQUEST', { cause: error })
    }
  }

  /** Keep audit payloads bounded before they cross the guest/host boundary. */
  private summary(value: unknown): string | undefined {
    if (value === undefined) return undefined
    let rendered: string
    try { rendered = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value) }
    catch { rendered = '[unserializable]' }
    return rendered.length <= 2_048 ? rendered : `${rendered.slice(0, 2_047)}…`
  }

  private nodeText(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new WorkflowError(`node ${name} must be a non-empty string`, 'INVALID_ARGUMENT')
    return value
  }

  private nodeRetryCount(value: unknown): number {
    if (value === undefined) return 0
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 5) {
      throw new WorkflowError('node retryCount must be an integer between 0 and 5', 'INVALID_ARGUMENT')
    }
    return value as number
  }

  private nodeStart(rawNodeId: unknown, rawLabel: unknown, input: unknown, rawRetryCount?: unknown): void {
    const nodeId = this.nodeText(rawNodeId, 'id')
    const label = this.nodeText(rawLabel, 'label')
    if (this.liveNodes.has(nodeId)) throw new WorkflowError(`node ${nodeId} started more than once`, 'INVALID_ARGUMENT')
    const inputSummary = this.summary(input)
    const info: WorkflowNodeStartInfo = {
      nodeId,
      label,
      ...inputSummary === undefined ? {} : { inputSummary },
      retryCount: this.nodeRetryCount(rawRetryCount),
      startedAt: Date.now(),
    }
    this.liveNodes.set(nodeId, info)
    this.observer.nodeStart(info)
  }

  private nodeEnd(rawNodeId: unknown, rawLabel: unknown, rawStatus: unknown, output?: unknown, rawError?: unknown, rawRetryCount?: unknown): void {
    const nodeId = this.nodeText(rawNodeId, 'id')
    const label = this.nodeText(rawLabel, 'label')
    if (rawStatus !== 'completed' && rawStatus !== 'failed' && rawStatus !== 'skipped' && rawStatus !== 'blocked' && rawStatus !== 'cancelled') {
      throw new WorkflowError('node status is invalid', 'INVALID_ARGUMENT')
    }
    const status = rawStatus as WorkflowNodeEndInfo['status']
    const started = this.liveNodes.get(nodeId)
    if (status === 'skipped' || status === 'blocked') {
      if (started !== undefined) throw new WorkflowError(`node ${nodeId} cannot be skipped after starting`, 'INVALID_ARGUMENT')
    } else if (started === undefined) {
      throw new WorkflowError(`node ${nodeId} ended without a start`, 'INVALID_ARGUMENT')
    }
    const endedAt = Date.now()
    const base = started ?? { nodeId, label, retryCount: this.nodeRetryCount(rawRetryCount), startedAt: endedAt }
    const error = rawError === undefined ? undefined : this.nodeText(rawError, 'error')
    const outputSummary = this.summary(output)
    const info: WorkflowNodeEndInfo = {
      ...base,
      label,
      status,
      ...outputSummary === undefined ? {} : { outputSummary },
      ...error === undefined ? {} : { error: error.length <= 8_000 ? error : `${error.slice(0, 7_999)}…` },
      durationMs: Math.max(0, endedAt - base.startedAt),
      endedAt,
    }
    this.liveNodes.delete(nodeId)
    this.observer.nodeEnd(info)
  }

  /**
   * Run the script and materialize its JSON return value.
   * @returns A completed or error result; script failures never reject.
   */
  async drive(): Promise<WorkflowResult> {
    try {
      const scriptPromise = this.compiled.runInContext(this.context, { timeout: this.limits.syncTimeoutMs }) as Promise<unknown>
      const raw: unknown = await this.contain(Promise.resolve(scriptPromise))
      const value = raw === undefined ? null : this.materializeResult(raw)
      return { value, stopReason: 'completed', agentsStarted: this.started }
    } catch (error: unknown) {
      for (const info of this.liveNodes.values()) {
        const endedAt = Date.now()
        this.observer.nodeEnd({ ...info, status: 'failed', error: renderThrown(error), durationMs: Math.max(0, endedAt - info.startedAt), endedAt })
      }
      this.liveNodes.clear()
      return { value: null, stopReason: 'error', error: renderThrown(error), agentsStarted: this.started }
    }
  }

  /**
   * Attach a no-op rejection consumer WITHOUT changing what the caller
   * receives: if the script drops the promise, a host rejection cannot become
   * an unhandled rejection that kills the process; if
   * the script does await it, it still observes the rejection.
   */
  private contain<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => { /* consumed: see method contract — a dropped hook promise must not surface an unhandled rejection */ })
    return promise
  }

  /** Materialize the script's return value; violations become RESULT_UNSERIALIZABLE. */
  private materializeResult(raw: unknown): unknown {
    try {
      return materializeFromRealm(raw, 'workflow result')
    } catch (error: unknown) {
      /* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */
      if (!(error instanceof MaterializeError)) throw error
      throw new WorkflowError(
        `the workflow's return value is not plain JSON data — ${error.message}. Return only JSON-serializable objects/arrays/scalars.`,
        'RESULT_UNSERIALIZABLE',
        { cause: error },
      )
    }
  }

  /** Acquire one concurrency slot in FIFO order. */
  private acquireSlot(): Promise<void> {
    if (this.activeSlots < this.limits.maxConcurrentAgents) {
      this.activeSlots += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.slotWaiters.push(() => {
        this.activeSlots += 1
        resolve()
      })
    })
  }

  private releaseSlot(): void {
    this.activeSlots -= 1
    const next = this.slotWaiters.shift()
    if (next) next()
  }

  /** The `agent(prompt, opts)` hook. */
  private async agent(rawPrompt: unknown, rawOpts: unknown): Promise<unknown> {
    if (typeof rawPrompt !== 'string' || rawPrompt.length === 0) {
      throw new WorkflowError('agent() requires a non-empty prompt string', 'INVALID_ARGUMENT')
    }
    const opts = this.readAgentOptions(rawOpts)
    if (this.started >= this.limits.maxTotalAgents) {
      throw new WorkflowError(
        `this run reached its total agent cap (${this.limits.maxTotalAgents}) — a runaway-loop backstop; raise the applicable maxTotalAgents limit if the scale is intentional`,
        'AGENT_CAP',
      )
    }
    this.started += 1
    const seq = this.started
    const label = opts.label ?? defaultLabel(rawPrompt)
    const phase = opts.phase ?? this.currentPhase

    await this.acquireSlot()
    try {
      let run: ChildHandle
      try {
        run = await this.children.startAgent({
          prompt: rawPrompt,
          ...opts.schema !== undefined ? { schema: opts.schema } : {},
          ...opts.provider !== undefined ? { provider: opts.provider } : {},
          ...opts.model !== undefined ? { model: opts.model } : {},
          ...opts.toolFilter !== undefined ? { toolFilter: opts.toolFilter } : {},
        })
      } catch (error: unknown) {
        throw new WorkflowError(`agent() could not start a child: ${renderThrown(error)}`, 'AGENT_START', { cause: error })
      }
      const info: WorkflowAgentInfo = { seq, label, ...phase !== undefined ? { phase } : {}, childId: brandString<SessionId>(run.id) }
      this.observer.agentStart(info)
      try {
        let result
        try {
          result = await run.result
        } catch (error: unknown) {
          // A rejected child result is an INFRASTRUCTURE fault relayed by the
          // host — distinct from a child that failed and resolved. Pair the
          // lifecycle before propagating, and propagate FATAL: an ordinary
          // throw would dissolve to a per-item null inside the combinators,
          // and a broken provider must not read as a failed child.
          this.observer.agentEnd({ ...info, outcome: 'failed' })
          throw new WorkflowError(`child agent run failed: ${renderThrown(error)}`, 'AGENT_RESULT', { cause: error })
        }
        if (result.stopReason === 'completed') {
          if (opts.schema !== undefined) {
            // The provider honored outputSchema (capability-gated at start), so
            // a completed run without a structured value is a child failure.
            if (result.structured === undefined) {
              this.observer.agentEnd({ ...info, outcome: 'failed' })
              return null
            }
            this.observer.agentEnd({ ...info, outcome: 'completed' })
            return result.structured
          }
          this.observer.agentEnd({ ...info, outcome: 'completed' })
          return outputText(result.output)
        }
        this.observer.agentEnd({ ...info, outcome: 'failed' })
        return null
      } finally {
        await run.dispose()
      }
    } finally {
      this.releaseSlot()
    }
  }

  /** Materialize + validate the `agent()` options bag from the realm. */
  private readAgentOptions(rawOpts: unknown): {
    label?: string
    phase?: string
    provider?: string
    model?: string
    schema?: ObjectJsonSchema
    toolFilter?: ToolRestriction
  } {
    if (rawOpts === undefined) return {}
    let opts: unknown
    try {
      opts = materializeFromRealm(rawOpts, 'agent() options')
    } catch (error: unknown) {
      /* v8 ignore next -- defensive rethrow arm: materializeFromRealm only throws MaterializeError */
      if (!(error instanceof MaterializeError)) throw error
      throw new WorkflowError(`agent() options must be plain JSON data — ${error.message}`, 'INVALID_ARGUMENT', { cause: error })
    }
    if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
      throw new WorkflowError('agent() options must be an object', 'INVALID_ARGUMENT')
    }
    const record = opts as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (SUPPORTED_AGENT_OPTIONS.has(key)) continue
      if (DEFERRED_AGENT_OPTIONS.has(key)) {
        throw new WorkflowError(`agent() option "${key}" is deferred and not supported by this engine (supported: label, phase, schema, provider, model, toolFilter)`, 'UNSUPPORTED_OPTION')
      }
      throw new WorkflowError(`agent() option "${key}" is not recognized (supported: label, phase, schema, provider, model, toolFilter)`, 'UNSUPPORTED_OPTION')
    }
    for (const key of ['label', 'phase', 'provider', 'model'] as const) {
      if (record[key] !== undefined && typeof record[key] !== 'string') {
        throw new WorkflowError(`agent() option "${key}" must be a string`, 'INVALID_ARGUMENT')
      }
    }
    let schema: ObjectJsonSchema | undefined
    if (record.schema !== undefined) {
      try {
        assertObjectJsonSchema(record.schema)
        schema = record.schema
      } catch (error: unknown) {
        /* v8 ignore next -- defensive rethrow arm: assertObjectJsonSchema only throws JsonSchemaError */
        if (!(error instanceof JsonSchemaError)) throw error
        throw new WorkflowError(`agent() schema is outside the supported subset — ${error.message}`, 'UNSUPPORTED_SCHEMA', { cause: error })
      }
    }
    let toolFilter: ToolRestriction | undefined
    if (record.toolFilter !== undefined) {
      if (typeof record.toolFilter !== 'object' || record.toolFilter === null || Array.isArray(record.toolFilter)) {
        throw new WorkflowError('agent() option "toolFilter" must be an object', 'INVALID_ARGUMENT')
      }
      const filter = record.toolFilter as Record<string, unknown>
      const unknown = Object.keys(filter).find(key => key !== 'allow' && key !== 'deny')
      if (unknown !== undefined) throw new WorkflowError(`agent() option "toolFilter" has unknown field "${unknown}"`, 'INVALID_ARGUMENT')
      const readNames = (key: 'allow' | 'deny'): string[] | undefined => {
        if (filter[key] === undefined) return undefined
        if (!Array.isArray(filter[key]) || filter[key].some(name => typeof name !== 'string' || name.trim() === '')) {
          throw new WorkflowError(`agent() option "toolFilter.${key}" must be an array of non-empty strings`, 'INVALID_ARGUMENT')
        }
        return filter[key] as string[]
      }
      const allow = readNames('allow')
      const deny = readNames('deny')
      if (allow === undefined && deny === undefined) throw new WorkflowError('agent() option "toolFilter" must declare allow and/or deny', 'INVALID_ARGUMENT')
      toolFilter = { ...allow === undefined ? {} : { allow }, ...deny === undefined ? {} : { deny } }
    }
    return {
      ...record.label !== undefined ? { label: record.label as string } : {},
      ...record.phase !== undefined ? { phase: record.phase as string } : {},
      ...record.provider !== undefined ? { provider: record.provider as string } : {},
      ...record.model !== undefined ? { model: record.model as string } : {},
      ...schema !== undefined ? { schema } : {},
      ...toolFilter !== undefined ? { toolFilter } : {},
    }
  }

  /** The `parallel(thunks)` hook: each thunk caught → `null`; fatal errors propagate. */
  private async parallel(rawThunks: unknown): Promise<unknown[]> {
    if (!Array.isArray(rawThunks)) {
      throw new WorkflowError('parallel() requires an array of zero-argument functions', 'INVALID_ARGUMENT')
    }
    this.assertItemCap(rawThunks.length, 'parallel()')
    const thunks = rawThunks.map((thunk, index) => {
      if (typeof thunk !== 'function') {
        throw new WorkflowError(`parallel() item ${index} is not a function`, 'INVALID_ARGUMENT')
      }
      return thunk as () => unknown
    })
    return Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk()
      } catch (error: unknown) {
        // Hook failures are WorkflowErrors built OUTSIDE the script's realm;
        // fatality is recognized by `instanceof` against this realm's class —
        // a script-built object can never pass it, so fatality cannot be
        // forged (nor accidentally dissolved).
        if (isFatalWorkflowError(error)) throw error
        return null
      }
    }))
  }

  /** The `pipeline(items, ...stages)` hook: per-item stage chains, NO cross-stage barrier. */
  private async pipeline(rawItems: unknown, rawStages: unknown[]): Promise<unknown[]> {
    if (!Array.isArray(rawItems)) {
      throw new WorkflowError('pipeline() requires an items array', 'INVALID_ARGUMENT')
    }
    this.assertItemCap(rawItems.length, 'pipeline()')
    if (rawStages.length === 0) {
      throw new WorkflowError('pipeline() requires at least one stage function', 'INVALID_ARGUMENT')
    }
    const stages = rawStages.map((stage, index) => {
      if (typeof stage !== 'function') {
        throw new WorkflowError(`pipeline() stage ${index} is not a function`, 'INVALID_ARGUMENT')
      }
      return stage as (previous: unknown, item: unknown, index: number) => unknown
    })
    return Promise.all(rawItems.map(async (item: unknown, index) => {
      let value: unknown = item
      try {
        for (const stage of stages) {
          value = await stage(value, item, index)
        }
        return value
      } catch (error: unknown) {
        // An ordinary stage throw drops the ITEM to null and skips its
        // remaining stages; a fatal WorkflowError (see parallel()) kills the
        // whole script.
        if (isFatalWorkflowError(error)) throw error
        return null
      }
    }))
  }

  private assertItemCap(length: number, hook: string): void {
    if (length > this.limits.maxItemsPerCall) {
      throw new WorkflowError(
        `${hook} received ${length} items — over the per-call cap (${this.limits.maxItemsPerCall}); split the work or raise maxItemsPerCall in the engine config`,
        'ITEM_CAP',
      )
    }
  }

  /** The `phase(title)` hook: sets the current label for subsequent `agent()` calls and notifies observers. */
  private phase(title: unknown): void {
    if (typeof title !== 'string' || title.length === 0) {
      throw new WorkflowError('phase() requires a non-empty title string', 'INVALID_ARGUMENT')
    }
    this.currentPhase = title
    this.observer.phase(title)
  }

  /** The `log(message)` hook: narration to observers. */
  private log(message: unknown): void {
    if (typeof message !== 'string') {
      throw new WorkflowError('log() requires a message string', 'INVALID_ARGUMENT')
    }
    this.observer.log(message)
  }
}
