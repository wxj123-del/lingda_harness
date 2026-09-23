/** Workflow child ownership and progress over the shared sandboxed PTC executor. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PtcBindingFunction, PtcJsonValue, PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ObjectJsonSchema, ToolRestriction } from '@deepseek-ai/dsh-tools'
import { assertNever, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { WorkflowError } from '@deepseek-ai/dsh-workflow'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowMeta, WorkflowNodeEndInfo, WorkflowNodeStartInfo, WorkflowResult, WorkflowRun, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { WORKFLOW_GUEST_SOURCE } from './guest-source.ts'
import type { WorkflowProgress } from './guest-types.ts'
import { renderThrown } from './realm.ts'
import type { ExecutionObserver } from './runtime.ts'
import type { ChildStartRequest, WorkerInit, WorkflowHttpRequest, WorkflowHttpResponse } from './types.ts'

/** Deployment-level controls for host-side workflow HTTP requests. */
export interface WorkflowHttpPolicy {
  /** Hostname patterns. `*` permits public HTTP(S) hosts; `*.example.com` matches subdomains. */
  readonly allowedHosts: readonly string[]
  /** Per-request wall clock cap. */
  readonly timeoutMs: number
  /** Maximum encoded request body size. */
  readonly maxRequestBytes: number
  /** Maximum response bytes read from the network. */
  readonly maxResponseBytes: number
  /** Maximum decoded response characters returned to the guest. */
  readonly maxResponseChars: number
  /** Resolve a named credential without exposing its value to workflow logs. */
  readonly resolveCredential?: (reference: string) => Promise<string | undefined>
  /** Optional DNS policy check used when a wildcard allowlist is enabled. */
  readonly resolveAddresses?: (hostname: string) => Promise<readonly string[]>
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const SENSITIVE_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2', 'authorization', 'proxy-authenticate', 'proxy-authorization'])

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0' || host === '::' || host === '::1') return true
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped?.[1] !== undefined) return isPrivateHost(mapped[1])
  const octets = host.split('.').map(Number)
  if (octets.length === 4 && octets.every(Number.isInteger) && octets.every(octet => octet >= 0 && octet <= 255)) {
    return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) || (octets[0] === 198 && octets[1] === 18)
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
}

function hostAllowed(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return patterns.some((pattern) => {
    const candidate = pattern.trim().toLowerCase()
    if (candidate === '*') return true
    if (candidate.startsWith('*.')) return host.endsWith(candidate.slice(1)) && host !== candidate.slice(2)
    return host === candidate
  })
}

function headerSnapshot(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase()
    if (SENSITIVE_RESPONSE_HEADERS.has(normalized) || value.length > 4_096) continue
    result[normalized] = value
  }
  return result
}

async function readResponseBody(response: Response, policy: WorkflowHttpPolicy): Promise<{ body: string; truncated: boolean }> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > policy.maxResponseBytes) {
    await response.body?.cancel()
    throw new Error(`response exceeds the workflow limit of ${policy.maxResponseBytes} bytes`)
  }
  if (response.body === null) return { body: '', truncated: false }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = policy.maxResponseBytes - total
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, Math.max(0, remaining)))
        total = policy.maxResponseBytes
        truncated = true
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const decoded = new TextDecoder().decode(bytes)
  return { body: decoded.slice(0, policy.maxResponseChars), truncated: truncated || decoded.length > policy.maxResponseChars }
}

async function executeHttpRequest(request: WorkflowHttpRequest, policy: WorkflowHttpPolicy, signal: AbortSignal): Promise<WorkflowHttpResponse> {
  const method = request.method.toUpperCase()
  if (!HTTP_METHODS.has(method)) throw new Error(`HTTP method ${method} is not allowed by the workflow host`)
  let url: URL
  try { url = new URL(request.url) } catch { throw new Error('workflow HTTP URL is invalid') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') throw new Error('workflow HTTP URL must be HTTP(S) without embedded credentials')
  if (isPrivateHost(url.hostname) || !hostAllowed(url.hostname, policy.allowedHosts)) throw new Error(`workflow HTTP host "${url.hostname}" is not allowed`)
  if (policy.resolveAddresses !== undefined) {
    const addresses = await policy.resolveAddresses(url.hostname)
    if (addresses.length === 0 || addresses.some(isPrivateHost)) throw new Error(`workflow HTTP host "${url.hostname}" resolved to a private address`)
  }

  let body: string | undefined
  if (request.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    const bytes = new TextEncoder().encode(body)
    if (bytes.byteLength > policy.maxRequestBytes) throw new Error(`request body exceeds the workflow limit of ${policy.maxRequestBytes} bytes`)
  }
  const headers: Record<string, string> = { accept: 'application/json,text/plain,text/*;q=0.9,*/*;q=0.1' }
  if (body !== undefined && typeof request.body !== 'string') headers['content-type'] = 'application/json'
  if (request.credential !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(request.credential)) throw new Error('workflow credential reference is invalid')
    let value: string | undefined
    try {
      value = await policy.resolveCredential?.(request.credential) ?? process.env[request.credential]
    } catch {
      throw new Error(`workflow credential "${request.credential}" could not be resolved`)
    }
    if (value === undefined || value === '') throw new Error(`workflow credential "${request.credential}" is not configured`)
    headers.authorization = `Bearer ${value}`
  }
  const timeout = new AbortController()
  const abort = (): void => { timeout.abort(signal.reason ?? new Error('workflow HTTP request aborted')) }
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => timeout.abort(new Error('workflow HTTP request timed out')), policy.timeoutMs)
  try {
    const response = await fetch(url, { method, headers, ...body === undefined ? {} : { body }, redirect: 'manual', signal: timeout.signal })
    const result = await readResponseBody(response, policy)
    const contentType = response.headers.get('content-type') ?? ''
    let parsed: unknown
    if (contentType.toLowerCase().includes('json') && result.body !== '') {
      try { parsed = JSON.parse(result.body) } catch { /* preserve the bounded text body */ }
    }
    return { url: url.toString(), status: response.status, headers: headerSnapshot(response.headers), body: result.body, truncated: result.truncated, ...parsed === undefined ? {} : { json: parsed } }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

interface ChildRecord {
  readonly callId: number
  readonly run: SubagentRun
  disposal?: Promise<void>
}

const GUEST_URL = `data:text/javascript,${encodeURIComponent(WORKFLOW_GUEST_SOURCE)}`
const PROGRAM = `const { runWorkflowGuest } = await import(${JSON.stringify(GUEST_URL)}); return await runWorkflowGuest(workflowHost);`
const NODE_AUDIT_SUMMARY_MAX = 4_096
const NODE_AUDIT_LABEL_MAX = 512

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('workflow binding requires an object')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`workflow ${name} must be a string`)
  return value
}

function json(value: unknown): PtcJsonValue {
  const result = snapshotJsonValue(value)
  if (result === undefined) throw new Error('workflow binding value must be lossless JSON')
  return result as PtcJsonValue
}

function childRequest(value: unknown): ChildStartRequest {
  const request = object(value)
  const prompt = text(request.prompt, 'prompt')
  const provider = request.provider === undefined ? undefined : text(request.provider, 'provider')
  const model = request.model === undefined ? undefined : text(request.model, 'model')
  let schema: ObjectJsonSchema | undefined
  if (request.schema !== undefined) {
    const candidate = object(request.schema)
    assertObjectJsonSchema(candidate)
    schema = candidate
  }
  let toolFilter: ToolRestriction | undefined
  if (request.toolFilter !== undefined) {
    const candidate = object(request.toolFilter)
    const unknown = Object.keys(candidate).find(key => key !== 'allow' && key !== 'deny')
    if (unknown !== undefined) throw new Error(`workflow toolFilter has unknown field "${unknown}"`)
    const readNames = (key: 'allow' | 'deny'): string[] | undefined => {
      if (candidate[key] === undefined) return undefined
      if (!Array.isArray(candidate[key]) || candidate[key].some(name => typeof name !== 'string' || name.trim() === '')) {
        throw new Error(`workflow toolFilter.${key} must be an array of non-empty strings`)
      }
      return candidate[key] as string[]
    }
    const allow = readNames('allow')
    const deny = readNames('deny')
    if (allow === undefined && deny === undefined) throw new Error('workflow toolFilter must declare allow and/or deny')
    toolFilter = { ...allow === undefined ? {} : { allow }, ...deny === undefined ? {} : { deny } }
  }
  return {
    prompt,
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...schema === undefined ? {} : { schema },
    ...toolFilter === undefined ? {} : { toolFilter },
  }
}

function agentInfo(value: unknown): WorkflowAgentInfo {
  const info = object(value)
  if (!Number.isSafeInteger(info.seq) || (info.seq as number) < 1) throw new Error('workflow agent sequence must be a positive integer')
  return {
    seq: info.seq as number,
    label: text(info.label, 'agent label'),
    childId: SessionId(text(info.childId, 'child id')),
    ...info.phase === undefined ? {} : { phase: text(info.phase, 'agent phase') },
  }
}

function progress(value: unknown): WorkflowProgress {
  const event = object(value)
  switch (event.type) {
    case 'phase': return { type: 'phase', title: text(event.title, 'phase') }
    case 'log': return { type: 'log', message: text(event.message, 'log') }
    case 'agent-start': return { type: 'agent-start', info: agentInfo(event.info) }
    case 'agent-end': {
      const info = object(event.info)
      if (info.outcome !== 'completed' && info.outcome !== 'failed' && info.outcome !== 'cancelled') throw new Error('invalid workflow agent outcome')
      return { type: 'agent-end', info: { ...agentInfo(info), outcome: info.outcome } }
    }
    case 'node-start': return { type: 'node-start', info: nodeStartInfo(event.info) }
    case 'node-end': return { type: 'node-end', info: nodeEndInfo(event.info) }
    default: throw new Error('invalid workflow progress event')
  }
}

function nodeStartInfo(value: unknown): WorkflowNodeStartInfo {
  const info = object(value)
  if (typeof info.nodeId !== 'string' || info.nodeId.trim() === '') throw new Error('workflow node id must be a non-empty string')
  if (typeof info.label !== 'string' || info.label.trim() === '' || info.label.length > NODE_AUDIT_LABEL_MAX) throw new Error('workflow node label must be a non-empty bounded string')
  if (typeof info.nodeId !== 'string' || info.nodeId.length > NODE_AUDIT_LABEL_MAX) throw new Error('workflow node id is too long')
  if (info.inputSummary !== undefined && (typeof info.inputSummary !== 'string' || info.inputSummary.length > NODE_AUDIT_SUMMARY_MAX)) throw new Error('workflow node input summary is too large')
  if (!Number.isSafeInteger(info.retryCount) || (info.retryCount as number) < 0 || (info.retryCount as number) > 5) throw new Error('workflow node retry count must be an integer between 0 and 5')
  if (!Number.isSafeInteger(info.startedAt) || (info.startedAt as number) < 0) throw new Error('workflow node start time must be a non-negative integer')
  return {
    nodeId: info.nodeId,
    label: info.label,
    ...info.inputSummary === undefined ? {} : { inputSummary: info.inputSummary },
    retryCount: info.retryCount as number,
    startedAt: info.startedAt as number,
  }
}

function nodeEndInfo(value: unknown): WorkflowNodeEndInfo {
  const info = object(value)
  const start = nodeStartInfo(info)
  if (info.status !== 'completed' && info.status !== 'failed' && info.status !== 'skipped' && info.status !== 'blocked' && info.status !== 'cancelled') throw new Error('invalid workflow node status')
  if (info.outputSummary !== undefined && (typeof info.outputSummary !== 'string' || info.outputSummary.length > NODE_AUDIT_SUMMARY_MAX)) throw new Error('workflow node output summary is too large')
  if (info.error !== undefined && (typeof info.error !== 'string' || info.error.length > 8_000)) throw new Error('workflow node error is too large')
  if (!Number.isSafeInteger(info.durationMs) || (info.durationMs as number) < 0) throw new Error('workflow node duration must be a non-negative integer')
  if (!Number.isSafeInteger(info.endedAt) || (info.endedAt as number) < start.startedAt) throw new Error('workflow node end time is invalid')
  return {
    ...start,
    status: info.status,
    ...info.outputSummary === undefined ? {} : { outputSummary: info.outputSummary },
    ...info.error === undefined ? {} : { error: info.error },
    durationMs: info.durationMs as number,
    endedAt: info.endedAt as number,
  }
}

function progressBatch(value: unknown): WorkflowProgress[] {
  if (!Array.isArray(value)) throw new Error('workflow progress requires an array of events')
  return value.map(progress)
}

function workflowResult(value: unknown): WorkflowResult {
  const result = object(value)
  if (result.stopReason !== 'completed' && result.stopReason !== 'error' && result.stopReason !== 'cancelled') throw new Error('invalid workflow stop reason')
  if (!Number.isSafeInteger(result.agentsStarted) || (result.agentsStarted as number) < 0) throw new Error('invalid workflow agent count')
  if (!Object.hasOwn(result, 'value')) throw new Error('workflow result is missing its value')
  return {
    value: result.value,
    stopReason: result.stopReason,
    agentsStarted: result.agentsStarted as number,
    ...result.error === undefined ? {} : { error: text(result.error, 'error') },
  }
}

/**
 * Holder-owned workflow. Cancellation stops the program immediately; settlement waits for
 * its managed process and every admitted child startup/disposal. Engine unload does not
 * invalidate the captured runtime or subagent handles.
 */
export class PtcWorkflowRun implements WorkflowRun {
  readonly result: Promise<WorkflowResult>
  private readonly controller = new AbortController()
  private readonly children = new Map<number, ChildRecord>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly liveAgents = new Map<number, WorkflowAgentInfo>()
  private readonly liveNodes = new Map<string, WorkflowNodeStartInfo>()
  private started = 0
  private terminal = false
  private cancelReason: string | undefined
  private disposed: Promise<void> | undefined
  private readonly externalAbort: () => void

  constructor(
    private readonly ctx: Context,
    private readonly subagents: SubagentRuntime,
    private readonly runtime: PtcRuntime,
    readonly id: WorkflowRunId,
    readonly meta: WorkflowMeta,
    private readonly parent: Agent,
    private readonly init: WorkerInit,
    private readonly provider: string,
    private readonly policy: SandboxExecutionPolicy,
    private readonly observer: ExecutionObserver,
    private readonly httpPolicy: WorkflowHttpPolicy,
    private readonly signal?: AbortSignal,
  ) {
    this.externalAbort = () => { this.cancel('workflow signal aborted') }
    if (signal?.aborted) this.externalAbort()
    else signal?.addEventListener('abort', this.externalAbort, { once: true })
    // Consumers attach durable run recording after start() returns.
    this.result = Promise.resolve().then(() => this.drive())
  }

  /**
   * Stop the script and abort pending and published children.
   * @param reason - Human-readable cancellation cause; the first request wins.
   */
  cancel(reason = 'workflow cancelled'): void {
    if (this.terminal || this.cancelReason !== undefined) return
    this.cancelReason = reason
    this.controller.abort(reason)
    for (const record of this.children.values()) void this.disposeChild(record)
  }

  /**
   * Cancel unfinished work and await the program and child cleanup.
   * @returns One shared completion promise for repeated disposal calls.
   */
  dispose(): Promise<void> {
    this.cancel('workflow disposed')
    this.disposed ??= this.result.then(() => {})
    return this.disposed
  }

  private requireActive(): void {
    this.controller.signal.throwIfAborted()
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }

  private bindings(): Record<string, PtcBindingFunction> {
    return {
      begin: () => { this.requireActive(); return Promise.resolve(json(this.init)) },
      startChild: value => this.track(this.startChild(childRequest(value))),
      childResult: value => this.track(this.childResult(this.child(value))),
      disposeChild: async (value) => { await this.disposeChild(this.child(value)); return null },
      httpRequest: value => this.track(this.httpRequest(value)),
      progress: (value) => {
        for (const event of progressBatch(value)) this.onProgress(event)
        return Promise.resolve(null)
      },
    }
  }

  private async httpRequest(value: unknown): Promise<PtcJsonValue> {
    const request = object(value)
    const unknown = Object.keys(request).find(key => !['url', 'method', 'body', 'credential'].includes(key))
    if (unknown !== undefined) throw new Error(`workflow httpRequest has unknown field "${unknown}"`)
    const url = text(request.url, 'HTTP url')
    const method = text(request.method, 'HTTP method').toUpperCase()
    const credential = request.credential === undefined ? undefined : text(request.credential, 'HTTP credential')
    const http: WorkflowHttpRequest = {
      url,
      method,
      ...Object.hasOwn(request, 'body') ? { body: request.body } : {},
      ...credential === undefined ? {} : { credential },
    }
    try {
      const result = await executeHttpRequest(http, this.httpPolicy, this.controller.signal)
      return json(result)
    } catch (error) {
      if (this.cancelReason !== undefined) {
        throw new WorkflowError(`workflow HTTP request cancelled: ${this.cancelReason ?? 'workflow cancelled'}`, 'CANCELLED', { cause: error })
      }
      throw error
    }
  }

  private child(value: unknown): ChildRecord {
    this.requireActive()
    const callId = object(value).callId
    if (!Number.isSafeInteger(callId)) throw new Error('workflow child call id must be an integer')
    const record = this.children.get(callId as number)
    if (record === undefined) throw new Error('workflow child call is not active')
    return record
  }

  private async startChild(request: ChildStartRequest): Promise<PtcJsonValue> {
    this.requireActive()
    const callId = ++this.started
    const run = await this.subagents.start(this.provider, {
      prompt: [{ type: 'text', text: request.prompt }],
      parent: this.parent,
      signal: this.controller.signal,
      ...request.schema === undefined ? {} : { outputSchema: request.schema },
      ...request.toolFilter === undefined ? {} : { toolFilter: request.toolFilter },
      ...request.provider === undefined && request.model === undefined ? {} : {
        agentOptions: {
          ...request.provider === undefined ? {} : { provider: request.provider },
          ...request.model === undefined ? {} : { model: request.model },
        },
      },
    })
    const record: ChildRecord = { callId, run }
    this.children.set(callId, record)
    // A provider can publish after the signal fired while startup was pending.
    if (this.controller.signal.aborted) {
      await this.disposeChild(record)
      throw new Error('workflow child started after cancellation')
    }
    return { callId, childId: run.id }
  }

  private async childResult(record: ChildRecord): Promise<PtcJsonValue> {
    const signal = this.controller.signal
    signal.throwIfAborted()
    const aborted = Promise.withResolvers<never>()
    const onAbort = (): void => { aborted.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await Promise.race([record.run.result, aborted.promise])
      return json({
        output: result.output,
        stopReason: result.stopReason,
        ...result.structured === undefined ? {} : { structured: result.structured },
      })
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private disposeChild(record: ChildRecord): Promise<void> {
    record.disposal ??= Promise.resolve().then(() => record.run.dispose()).catch((error: unknown) => {
      this.ctx.logger.warn(`workflow-ptc: child dispose failed: ${renderThrown(error)}`)
    }).finally(() => {
      this.children.delete(record.callId)
    })
    return record.disposal
  }

  private onProgress(event: WorkflowProgress): void {
    this.requireActive()
    switch (event.type) {
      case 'phase': this.observer.phase(event.title); break
      case 'log': this.observer.log(event.message); break
      case 'agent-start':
        this.liveAgents.set(event.info.seq, event.info)
        this.observer.agentStart(event.info)
        break
      case 'agent-end': this.endAgent(event.info); break
      case 'node-start':
        this.liveNodes.set(event.info.nodeId, event.info)
        this.observer.nodeStart(event.info)
        break
      case 'node-end':
        this.liveNodes.delete(event.info.nodeId)
        this.observer.nodeEnd(event.info)
        break
      /* v8 ignore next -- progress() validates the closed message union before dispatch. */
      default: assertNever(event, 'workflow progress')
    }
  }

  private endAgent(info: WorkflowAgentEndInfo): void {
    if (!this.liveAgents.delete(info.seq)) return
    this.observer.agentEnd(info)
  }

  private cancelled(): WorkflowResult {
    return { value: null, stopReason: 'cancelled', error: `workflow run cancelled: ${this.cancelReason}`, agentsStarted: this.started }
  }

  private async drive(): Promise<WorkflowResult> {
    let result: WorkflowResult
    try {
      const outcome = await this.runtime.run(this.runtime.resolve({
        program: PROGRAM,
        bindings: [{ global: 'workflowHost', functions: this.bindings() }],
        cwd: this.policy.workspaceRoot,
        sandboxPolicy: this.policy,
        timeoutMs: null,
        signal: this.controller.signal,
      }))
      this.terminal = true
      if (this.cancelReason !== undefined) result = this.cancelled()
      else if (outcome.error !== undefined) result = { value: null, stopReason: 'error', error: `workflow execution failed (${outcome.error.kind}): ${outcome.error.message}`, agentsStarted: this.started }
      else result = workflowResult(outcome.value)
    } catch (error: unknown) {
      this.terminal = true
      result = this.cancelReason === undefined
        ? { value: null, stopReason: 'error', error: renderThrown(error), agentsStarted: this.started }
        : this.cancelled()
    } finally {
      this.terminal = true
      this.signal?.removeEventListener('abort', this.externalAbort)
      this.controller.abort('workflow settled')
      // Disposing published children releases binding waits; pending starts may publish more.
      for (const record of this.children.values()) void this.disposeChild(record)
      while (this.pending.size > 0) await Promise.allSettled([...this.pending])
      await Promise.all([...this.children.values()].map(record => this.disposeChild(record)))
      this.children.clear()
      for (const info of this.liveAgents.values()) this.endAgent({ ...info, outcome: 'cancelled' })
      for (const info of this.liveNodes.values()) {
        const endedAt = Date.now()
        this.observer.nodeEnd({
          ...info,
          status: 'cancelled',
          error: this.cancelReason ?? 'workflow stopped before node completion',
          durationMs: Math.max(0, endedAt - info.startedAt),
          endedAt,
        })
      }
      this.liveNodes.clear()
    }
    return result
  }
}
