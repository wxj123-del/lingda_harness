/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { hostname } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { canOpenNativePath, nativeFileManager, openNativePath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  WorkflowEngine, WorkflowNodeEndInfo, WorkflowNodeStartInfo, WorkflowResult, WorkflowRun, WorkflowRunId,
} from '@deepseek-ai/dsh-workflow'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ApiSessionAgentController,
  ApiSessionNotFound,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList } from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import { SessionMediaReferences } from './media-references.ts'
import type {
  ModelCatalog,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  WorkflowRemoteRunListValue,
  WorkflowRemoteRunRequest,
  WorkflowRemoteRunsRequest,
  WorkflowRemoteRunView,
  WorkflowNodeAudit,
  WorkflowRemoteStartRequest,
  WorkflowRemoteStartValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native file-manager handoff. */
  readonly revealPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

interface WorkflowRecord {
  readonly sessionId: SessionId
  readonly workflowId: string
  readonly session: Session
  readonly run: WorkflowRun
  readonly nodeIds: ReadonlySet<string>
  view: WorkflowRemoteRunView
  timeout?: ReturnType<typeof setTimeout>
  timedOut?: boolean
}

const WORKFLOW_MAX_CONCURRENT_PER_SESSION = 3
const WORKFLOW_MAX_CONCURRENT_GLOBAL = 12
const WORKFLOW_MAX_ARGS_BYTES = 256_000
const WORKFLOW_MAX_NAME_LENGTH = 160
const WORKFLOW_MAX_RESULT_BYTES = 512_000
const WORKFLOW_MAX_ERROR_LENGTH = 8_000
const WORKFLOW_MAX_NODE_AUDIT = 512
const WORKFLOW_MAX_NODE_SUMMARY = 4_096
const WORKFLOW_MAX_NODE_ID_LENGTH = 120

function boundedWorkflowError(value: string): string {
  return value.length <= WORKFLOW_MAX_ERROR_LENGTH ? value : `${value.slice(0, WORKFLOW_MAX_ERROR_LENGTH)}…`
}

function boundedNodeSummary(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.length <= WORKFLOW_MAX_NODE_SUMMARY ? value : `${value.slice(0, WORKFLOW_MAX_NODE_SUMMARY - 1)}…`
}

function validWorkflowAudit(value: unknown): value is WorkflowNodeAudit {
  if (typeof value !== 'object' || value === null) return false
  const audit = value as Partial<WorkflowNodeAudit>
  if (typeof audit.correlationId !== 'string' || audit.correlationId.trim() === ''
    || typeof audit.nodeId !== 'string' || audit.nodeId.trim() === ''
    || typeof audit.label !== 'string' || audit.label.trim() === '') return false
  if (audit.status !== 'running' && audit.status !== 'completed' && audit.status !== 'failed' && audit.status !== 'skipped' && audit.status !== 'blocked' && audit.status !== 'cancelled') return false
  if (!Number.isSafeInteger(audit.startedAt) || (audit.startedAt as number) < 0) return false
  if (audit.endedAt !== undefined && (!Number.isSafeInteger(audit.endedAt) || audit.endedAt < (audit.startedAt as number))) return false
  if (audit.durationMs !== undefined && (!Number.isSafeInteger(audit.durationMs) || audit.durationMs < 0)) return false
  if (!Number.isSafeInteger(audit.retryCount) || (audit.retryCount as number) < 0 || (audit.retryCount as number) > 5) return false
  return (audit.inputSummary === undefined || typeof audit.inputSummary === 'string' && audit.inputSummary.length <= WORKFLOW_MAX_NODE_SUMMARY)
    && (audit.outputSummary === undefined || typeof audit.outputSummary === 'string' && audit.outputSummary.length <= WORKFLOW_MAX_NODE_SUMMARY)
    && (audit.error === undefined || typeof audit.error === 'string' && audit.error.length <= WORKFLOW_MAX_ERROR_LENGTH)
}

function boundedWorkflowValue(value: unknown): JsonValue | undefined {
  const snapshot = snapshotJsonValue(value) as JsonValue | undefined
  if (snapshot === undefined) return undefined
  let encoded: string
  try {
    const encodedValue = JSON.stringify(snapshot)
    if (encodedValue === undefined) return { truncated: true, reason: 'unserializable result' }
    encoded = encodedValue
  } catch { return { truncated: true, reason: 'unserializable result' } }
  if (new TextEncoder().encode(encoded).byteLength <= WORKFLOW_MAX_RESULT_BYTES) return snapshot
  return { truncated: true, preview: encoded.slice(0, WORKFLOW_MAX_RESULT_BYTES) }
}

function appendWorkflowCheckpoint(session: Session, view: WorkflowRemoteRunView): void {
  try {
    // The checkpoint is auxiliary history. Older Hosts can safely skip it while
    // still reconstructing the conversation, so retain the ignorable marker.
    session.append('visual-workflow/run', view, { ignorable: true })
  } catch {
    // History remains available in memory when the session is read-only or its event sink is unavailable.
  }
}

function appendWorkflowNodeAudit(session: Session, audit: WorkflowNodeAudit): void {
  try {
    // Node updates are an incremental auxiliary history. The run checkpoint
    // remains the compact recovery anchor for start and terminal state.
    session.append('visual-workflow/node', audit, { ignorable: true })
  } catch {
    // The in-memory run remains authoritative when the session cannot append.
  }
}

function applyWorkflowAudit(current: readonly WorkflowNodeAudit[], audit: WorkflowNodeAudit): readonly WorkflowNodeAudit[] {
  const index = current.findIndex(entry => entry.nodeId === audit.nodeId)
  if (audit.status === 'running') {
    if (index !== -1 && current[index]?.status === 'running') return current
    if (index !== -1) {
      const next = [...current]
      next[index] = audit
      return next
    }
    return [...current, audit].slice(-WORKFLOW_MAX_NODE_AUDIT)
  }
  if (index === -1) return [...current, audit].slice(-WORKFLOW_MAX_NODE_AUDIT)
  const next = [...current]
  next[index] = audit
  return next
}

function mergeWorkflowAudits(
  current: readonly WorkflowNodeAudit[],
  updates: readonly WorkflowNodeAudit[],
): readonly WorkflowNodeAudit[] {
  return updates.reduce<readonly WorkflowNodeAudit[]>(applyWorkflowAudit, current)
}

function workflowViewsFromEvents(events: readonly { readonly type: string; readonly data: unknown }[]): readonly WorkflowRemoteRunView[] {
  const latest = new Map<string, WorkflowRemoteRunView>()
  const pendingAudit = new Map<string, WorkflowNodeAudit[]>()
  for (const event of events) {
    if (event.type === 'visual-workflow/node') {
      if (!validWorkflowAudit(event.data)) continue
      const audit = event.data
      const runId = String(audit.correlationId)
      const view = latest.get(runId)
      if (view === undefined) {
        const pending = pendingAudit.get(runId) ?? []
        pendingAudit.set(runId, applyWorkflowAudit(pending, audit).slice() as WorkflowNodeAudit[])
      } else {
        latest.set(runId, { ...view, audit: applyWorkflowAudit(view.audit ?? [], audit) })
      }
      continue
    }
    if (event.type !== 'visual-workflow/run' || typeof event.data !== 'object' || event.data === null) continue
    const view = event.data as Partial<WorkflowRemoteRunView>
    const agentsStarted = view.agentsStarted
    if (typeof view.runId !== 'string' || typeof view.workflowId !== 'string' || typeof view.name !== 'string'
      || view.source !== 'visual-editor' || !Number.isFinite(view.startedAt)
      || typeof agentsStarted !== 'number' || !Number.isSafeInteger(agentsStarted) || agentsStarted < 0
      || (view.workflowVersion !== undefined && (!Number.isSafeInteger(view.workflowVersion) || view.workflowVersion < 1 || view.workflowVersion > 1_000_000_000))
      || !['running', 'completed', 'cancelled', 'error'].includes(view.status as string)
      || (view.audit !== undefined && (!Array.isArray(view.audit) || view.audit.length > WORKFLOW_MAX_NODE_AUDIT || !view.audit.every(validWorkflowAudit)))) continue
    const pending = pendingAudit.get(view.runId)
    const previous = latest.get(view.runId)
    const checkpointAudit = view.audit === undefined
      ? (previous?.audit ?? [])
      : mergeWorkflowAudits(previous?.audit ?? [], view.audit)
    const audit = pending === undefined ? checkpointAudit : mergeWorkflowAudits(checkpointAudit, pending)
    latest.set(view.runId, {
      ...event.data as WorkflowRemoteRunView,
      ...(view.audit !== undefined || audit.length > 0 ? { audit } : {}),
    })
    pendingAudit.delete(view.runId)
  }
  return [...latest.values()]
}

function recoverInterruptedWorkflowViews(views: readonly WorkflowRemoteRunView[]): readonly WorkflowRemoteRunView[] {
  return views.map(view => view.status === 'running'
    ? {
      ...view,
      status: 'error',
      endedAt: view.endedAt ?? view.startedAt,
      error: view.error ?? 'Host restarted before this workflow run completed',
    }
    : view)
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'fileUploads',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    nativeOpen: z.boolean(),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly revealPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()
  private readonly workflowRuns = new Map<string, WorkflowRecord>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - native-opener deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    installModelSelectionProjection(ctx)
    this.agents = new ApiSessionAgentController(ctx)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    ctx.effect(() => ctx.fileUploads.registerAgentResolver(async (sessionId) => {
      const result = await this.agents.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      return result.agent
    }), 'session-controller: file-upload Agent resolver')
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) })
    this.listState = new ApiSessionList(ctx)
    this.openPath = internals.openPath ?? openNativePath
    this.revealPath = internals.revealPath ?? revealNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionMediaReferences)
    ctx.plugin(SessionSkillCatalog)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
      for (const record of this.workflowRuns.values()) {
        if (record.sessionId === session.id && record.view.status === 'running') {
          record.run.cancel('session disposed')
        }
      }
    })
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('workflow/node-start', (info, node) => { this.recordWorkflowNodeStart(info.id, node) })
    ctx.on('workflow/node-end', (info, node) => { this.recordWorkflowNodeEnd(info.id, node) })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
    ctx.effect(() => async () => {
      for (const record of this.workflowRuns.values()) {
        if (record.view.status === 'running') record.run.cancel('session controller disposed')
      }
      await Promise.allSettled([...this.workflowRuns.values()].map(record => record.run.dispose()))
    }, 'session-controller.workflow-runs')
  }

  /** Start one editor-owned workflow without routing through a model prompt. */
  @Remote('workflowStart')
  async workflowStart(request: WorkflowRemoteStartRequest): Promise<WorkflowRemoteStartValue> {
    if (request.workflowId.trim() === '' || request.workflowId.length > WORKFLOW_MAX_NAME_LENGTH || !/^[A-Za-z0-9_.:-]+$/.test(request.workflowId)) {
      throw new RemoteError('gateway/bad-request', 'workflowId must be a short identifier', {})
    }
    if (request.script.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'workflow script must not be empty', {})
    }
    if (request.script.length > 1_000_000) {
      throw new RemoteError('gateway/bad-request', 'workflow script is too large', {})
    }
    if (!Array.isArray(request.nodeIds) || request.nodeIds.length === 0 || request.nodeIds.length > WORKFLOW_MAX_NODE_AUDIT) {
      throw new RemoteError('gateway/bad-request', 'workflow node manifest is invalid', {})
    }
    const nodeIds = new Set<string>()
    for (const nodeId of request.nodeIds) {
      if (typeof nodeId !== 'string' || nodeId.trim() === '' || nodeId.length > WORKFLOW_MAX_NODE_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(nodeId) || nodeIds.has(nodeId)) {
        throw new RemoteError('gateway/bad-request', 'workflow node manifest contains an invalid or duplicate node id', {})
      }
      nodeIds.add(nodeId)
    }
    if (request.workflowVersion !== undefined
      && (!Number.isSafeInteger(request.workflowVersion) || request.workflowVersion < 1 || request.workflowVersion > 1_000_000_000)) {
      throw new RemoteError('gateway/bad-request', 'workflow version must be a positive safe integer', {})
    }
    if (!request.meta || typeof request.meta.name !== 'string' || request.meta.name.trim() === '' || request.meta.name.length > WORKFLOW_MAX_NAME_LENGTH) {
      throw new RemoteError('gateway/bad-request', 'workflow metadata name is invalid', {})
    }
    const running = [...this.workflowRuns.values()].filter(record => record.view.status === 'running')
    if (running.length >= WORKFLOW_MAX_CONCURRENT_GLOBAL) {
      throw new RemoteError('gateway/busy', 'too many workflows are running', {})
    }
    if (running.filter(record => record.sessionId === request.sessionId).length >= WORKFLOW_MAX_CONCURRENT_PER_SESSION) {
      throw new RemoteError('gateway/busy', 'too many workflows are running in this session', {})
    }
    let argsBytes = 0
    if (request.args !== undefined) {
      try { argsBytes = new TextEncoder().encode(JSON.stringify(request.args)).byteLength } catch { argsBytes = WORKFLOW_MAX_ARGS_BYTES + 1 }
      if (argsBytes > WORKFLOW_MAX_ARGS_BYTES) throw new RemoteError('gateway/bad-request', 'workflow input is too large', {})
    }
    if (request.timeoutMs !== undefined
      && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 86_400_000)) {
      throw new RemoteError('gateway/bad-request', 'workflow timeout must be between 1 and 86400000 ms', {})
    }
    const found = await this.agents.resolveAgent(request.sessionId)
    if ('error' in found) throw found.error
    const engine = found.agent.ctx.get('workflowEngine') as WorkflowEngine | undefined
    if (engine === undefined) throw new RemoteError('gateway/internal', 'workflow engine is unavailable', {})
    const run = engine.start({
      script: request.script,
      meta: request.meta,
      args: request.args,
      parent: found.agent,
      nodeAudit: true,
    })
    const record: WorkflowRecord = {
      sessionId: request.sessionId,
      workflowId: request.workflowId,
      session: found.agent.session,
      run,
      nodeIds,
      view: {
        runId: run.id,
        workflowId: request.workflowId,
        ...(request.workflowVersion === undefined ? {} : { workflowVersion: request.workflowVersion }),
        name: run.meta.name,
        status: 'running',
        startedAt: Date.now(),
        agentsStarted: 0,
        source: 'visual-editor',
        audit: [],
        ...(argsBytes === 0 ? {} : { inputBytes: argsBytes }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      },
    }
    this.workflowRuns.set(String(run.id), record)
    appendWorkflowCheckpoint(record.session, record.view)
    this.trimWorkflowRuns()
    if (request.timeoutMs !== undefined) {
      record.timeout = setTimeout(() => {
        record.timedOut = true
        run.cancel('workflow timeout')
      }, request.timeoutMs)
    }
    void this.finishWorkflow(record)
    return { runId: run.id, status: 'running', startedAt: record.view.startedAt }
  }

  /** Request cancellation of one editor-owned workflow run. */
  @Remote('workflowCancel')
  async workflowCancel(request: WorkflowRemoteRunRequest): Promise<{ runId: WorkflowRunId; status: 'cancelling' }> {
    const record = this.workflowRuns.get(String(request.runId))
    if (record === undefined || record.sessionId !== request.sessionId) {
      const persisted = await this.workflowViews(request.sessionId)
      if (persisted.some(run => String(run.runId) === String(request.runId))) {
        throw new RemoteError('gateway/bad-request', `workflow run "${String(request.runId)}" is no longer running`, {})
      }
      throw new RemoteError('gateway/bad-request', `workflow run "${String(request.runId)}" was not found`, {})
    }
    if (record.view.status !== 'running') {
      throw new RemoteError('gateway/bad-request', `workflow run "${String(request.runId)}" is no longer running`, {})
    }
    record.run.cancel('cancelled by user')
    return { runId: record.run.id, status: 'cancelling' }
  }

  /** Read one redacted workflow execution state. */
  @Remote('workflowStatus')
  async workflowStatus(request: WorkflowRemoteRunRequest): Promise<WorkflowRemoteRunView> {
    const record = this.workflowRuns.get(String(request.runId))
    if (record !== undefined && record.sessionId === request.sessionId) return record.view
    const persisted = await this.workflowViews(request.sessionId)
      .then(runs => runs.find(run => String(run.runId) === String(request.runId)))
    if (persisted !== undefined) return persisted
    throw new RemoteError('gateway/bad-request', `workflow run "${String(request.runId)}" was not found`, {})
  }

  /** List recent workflow runs for the current editor/session. */
  @Remote('workflowList')
  async workflowList(sessionId: SessionId, request: WorkflowRemoteRunsRequest): Promise<WorkflowRemoteRunListValue> {
    const limit = request.limit === undefined ? 20 : Math.max(1, Math.min(100, Math.floor(request.limit)))
    const persisted = await this.workflowViews(sessionId)
    const runsById = new Map<string, WorkflowRemoteRunView>(persisted.map(run => [String(run.runId), run]))
    for (const record of this.workflowRuns.values()) {
      if (record.sessionId === sessionId) runsById.set(String(record.run.id), record.view)
    }
    const runs = [...runsById.values()]
      .filter(run => request.workflowId === undefined || run.workflowId === request.workflowId)
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, limit)
    return { runs }
  }

  private recordWorkflowNodeStart(runId: WorkflowRunId, node: WorkflowNodeStartInfo): void {
    const record = this.workflowRuns.get(String(runId))
    if (record === undefined || record.view.status !== 'running' || !record.nodeIds.has(node.nodeId)) return
    const current = [...(record.view.audit ?? [])]
    if (current.some(entry => entry.nodeId === node.nodeId && entry.status === 'running')) return
    const inputSummary = boundedNodeSummary(node.inputSummary)
    const audit: WorkflowNodeAudit = {
      correlationId: runId,
      nodeId: node.nodeId,
      label: node.label,
      status: 'running',
      startedAt: node.startedAt,
      retryCount: node.retryCount,
      ...(inputSummary === undefined ? {} : { inputSummary }),
    }
    const next = [...current.filter(entry => entry.nodeId !== node.nodeId), audit].slice(-WORKFLOW_MAX_NODE_AUDIT)
    record.view = { ...record.view, audit: next }
    appendWorkflowNodeAudit(record.session, audit)
  }

  private recordWorkflowNodeEnd(runId: WorkflowRunId, node: WorkflowNodeEndInfo): void {
    const record = this.workflowRuns.get(String(runId))
    if (record === undefined || record.view.status !== 'running' || !record.nodeIds.has(node.nodeId)) return
    const current = [...(record.view.audit ?? [])]
    const index = current.findIndex(entry => entry.nodeId === node.nodeId && entry.status === 'running')
    const previous = index === -1 ? undefined : current[index]
    const inputSummary = boundedNodeSummary(node.inputSummary ?? previous?.inputSummary)
    const outputSummary = boundedNodeSummary(node.outputSummary)
    const audit: WorkflowNodeAudit = {
      correlationId: runId,
      nodeId: node.nodeId,
      label: node.label,
      status: node.status,
      startedAt: previous?.startedAt ?? node.startedAt,
      endedAt: node.endedAt,
      durationMs: node.durationMs,
      retryCount: node.retryCount,
      ...inputSummary === undefined ? {} : { inputSummary },
      ...outputSummary === undefined ? {} : { outputSummary },
      ...node.error === undefined ? {} : { error: boundedWorkflowError(node.error) },
    }
    if (index === -1) current.push(audit)
    else current[index] = audit
    record.view = { ...record.view, audit: current.slice(-WORKFLOW_MAX_NODE_AUDIT) }
    appendWorkflowNodeAudit(record.session, audit)
  }

  private async workflowViews(sessionId: SessionId): Promise<readonly WorkflowRemoteRunView[]> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) return recoverInterruptedWorkflowViews(workflowViewsFromEvents(attached.snapshotEvents()))
    try {
      const inspection = await this.inspect(sessionId)
      return recoverInterruptedWorkflowViews(workflowViewsFromEvents(inspection.events))
    } catch (error) {
      if (error instanceof ApiSessionNotFound) return []
      throw error
    }
  }

  private async finishWorkflow(record: WorkflowRecord): Promise<void> {
    try {
      const result: WorkflowResult = await record.run.result
      const status = result.stopReason === 'completed' ? 'completed' : result.stopReason === 'cancelled' ? 'cancelled' : 'error'
      const value = boundedWorkflowValue(result.value)
      record.view = {
        ...record.view,
        status,
        endedAt: Date.now(),
        agentsStarted: result.agentsStarted,
        ...(result.error === undefined ? {} : { error: boundedWorkflowError(result.error) }),
        ...(value === undefined ? {} : { value }),
        ...(record.timedOut ? { timedOut: true } : {}),
      }
      appendWorkflowCheckpoint(record.session, record.view)
    } catch (error) {
      record.view = { ...record.view, status: 'error', endedAt: Date.now(), error: boundedWorkflowError(String(error)) }
      appendWorkflowCheckpoint(record.session, record.view)
    } finally {
      if (record.timeout !== undefined) clearTimeout(record.timeout)
      await record.run.dispose()
    }
  }

  private trimWorkflowRuns(): void {
    if (this.workflowRuns.size <= 100) return
    const settled = [...this.workflowRuns.entries()]
      .filter(([, record]) => record.view.status !== 'running')
      .sort((left, right) => left[1].view.startedAt - right[1].view.startedAt)
    for (const [id] of settled.slice(0, Math.max(0, this.workflowRuns.size - 100))) this.workflowRuns.delete(id)
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    return { items: await this.listState.list(signal) }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    return this.listState.search(request.query, signal)
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Describe the serving desktop for authenticated file-action routes.
   * @returns Host name, configured availability, and platform-specific file-manager behavior.
   */
  workspaceDesktop(): { name: string; available: boolean; fileManager: 'finder' | 'explorer' | 'directory' | null } {
    const fileManager = nativeFileManager()
    return { name: hostname(), available: fileManager !== null && this.canOpenPath(), fileManager }
  }

  /**
   * Open one path prepared by a Session-aware caller on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    if (request.path.length === 0) {
      throw new RemoteError(
        'gateway/bad-request',
        'session.openWorkspacePath requires a non-empty path',
        {},
      )
    }
    signal.throwIfAborted()
    try {
      if (request.action === 'reveal') await this.revealPath(request.path, signal)
      else await this.openPath(request.path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      throw new RemoteError(
        'gateway/internal',
        `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
      )
    }
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable completed-turn prefix into a new Session.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   */
  @Remote('fork')
  fork(request: SessionForkRequest): Promise<SessionForkValue> {
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    return this.commands.prompt(request)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence on a live Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): SessionUpdateQueueValue {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free durable event
   *   frames and optional cursorless assistant-stream frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.controlState.control(signal)
  }

}

export { buildModelCatalog }
export default SessionController
