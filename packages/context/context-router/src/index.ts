/** Global deterministic routing of durable session context into request snapshots. */

import type { Context } from '@deepseek-ai/cordis'
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  auditContextMessages,
  messageText,
  messageTokens,
  contextCapacity,
  resolveContextRoute,
  resolveContextRouteForMessages,
  resolveContextBudget,
  resolveRouterOptions,
  selectContextMessages,
  type ContextMessageAudit,
  type ContextRouterOptions,
} from './router.ts'

export {
  contextCapacity, messageText, messageTokens, resolveContextBudget, resolveContextRoute,
  resolveContextRouteForMessages, selectContextMessages,
}
export type {
  ContextAuditMetadata, ContextCapacity, ContextMessageAudit, ContextMessageKind, ContextRoute,
  ContextRouteSignal, ContextScope, ContextSelection, ContextRouterOptions,
} from './router.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'context-router'

/** Runtime marker consumed by policy layers that must avoid a second history trim. */
export interface ContextRouterService {
  readonly active: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextRouter: ContextRouterService
  }
}

/** Router configuration. */
export interface Config extends Partial<ContextRouterOptions> {
  /** Disable routing while retaining the plugin registration. */
  enabled?: boolean
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  enabled: z.boolean(),
  recentMessages: z.number().step(1).min(1),
  taskMessages: z.number().step(1).min(1),
  recallMessages: z.number().step(1).min(1),
  pluginContextRatio: z.number().min(0).max(1),
  maxTokens: z.number().step(1).min(1),
  safetyMarginTokens: z.number().step(1).min(0),
})

interface OpenTurnStart {
  turn: number
  messageId?: string
}

interface DurableTaskRecall {
  taskId: string
  turn: number
  messageIds: ReadonlySet<string>
}

interface PendingContextAudit {
  audit: ContextRouterAudit
}

interface PendingCalibrationSample {
  provider?: string
  model?: string
  estimatedRequestTokens: number
}

interface CalibrationState {
  samplesSeen: number
  deltas: number[]
  reserveTokens: number
  lastProviderInputTokens: number
  lastEstimatedRequestTokens: number
  lastDeltaTokens: number
}

interface CalibrationFold {
  consumedSeq: number
  byRoute: Map<string, CalibrationState>
}

/** Keep short-lived correlation state bounded when a stream is short-circuited. */
const MAX_PENDING_FINAL_AUDITS = 4
/** A continuation only needs the newest task turns; the full log remains durable. */
const MAX_INDEXED_TASK_TURNS = 8
/** Keep calibration durable but bounded per provider/model route. */
const MAX_CALIBRATION_SAMPLES = 16
const MAX_CALIBRATION_RESERVE_TOKENS = 4_096

function sameMessageIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

interface DurableTaskIndex {
  /** Number of events already folded into this index. */
  consumedSeq: number
  /** Turn currently receiving derived model messages while folding events. */
  activeTurn: number | undefined
  /** First direct user message recorded for each turn. */
  firstUserMessageByTurn: Map<number, string>
  /** Latest task lifecycle id recorded for each turn. */
  taskIdByTurn: Map<number, string>
  /** Model-visible message ids grouped by their durable turn. */
  messageIdsByTurn: Map<number, Set<string>>
  /** Incremental term-to-message postings used for task-history matching. */
  messageIdsByToken: Map<string, Set<string>>
  /** Terms whose postings were capped; those queries fall back to exact scanning. */
  truncatedTokens: Set<string>
  /** Once vocabulary is full, unknown terms fall back to exact scanning. */
  lexicalIndexSaturated: boolean
}

const TASK_EVENT_TYPES = new Set([
  'task/created', 'task/planned', 'task/running', 'task/waiting-human',
  'task/succeeded', 'task/failed', 'task/cancelled',
])
const MAX_TOKEN_POSTING_MESSAGES = 256
const MAX_INDEXED_TOKENS = 16_384

function calibrationRouteKey(provider: string | undefined, model: string | undefined): string | undefined {
  return provider === undefined || model === undefined ? undefined : `${provider}\u0000${model}`
}

function calibrationState(fold: CalibrationFold, key: string): CalibrationState {
  return fold.byRoute.get(key) ?? {
    samplesSeen: 0,
    deltas: [],
    reserveTokens: 0,
    lastProviderInputTokens: 0,
    lastEstimatedRequestTokens: 0,
    lastDeltaTokens: 0,
  }
}

/** Fold persisted provider calibration without rescanning the complete Session log. */
function calibrationFold(session: Session, folds: WeakMap<Session, CalibrationFold>): CalibrationFold {
  let fold = folds.get(session)
  if (fold === undefined) {
    fold = { consumedSeq: 0, byRoute: new Map() }
    folds.set(session, fold)
  }
  const endSeq = Number(session.seq)
  if (fold.consumedSeq >= endSeq) return fold
  for (const event of session.snapshotEvents(SessionLogOffset(fold.consumedSeq), session.seq)) {
    if (event.type !== 'context/calibration') continue
    const data = event.data
    const key = calibrationRouteKey(data.provider, data.model)
    if (key === undefined) continue
    fold.byRoute.set(key, {
      samplesSeen: data.samplesSeen,
      deltas: [...data.deltas],
      reserveTokens: data.reserveTokens,
      lastProviderInputTokens: data.lastProviderInputTokens,
      lastEstimatedRequestTokens: data.lastEstimatedRequestTokens,
      lastDeltaTokens: data.lastDeltaTokens,
    })
  }
  fold.consumedSeq = endSeq
  return fold
}

function providerPromptTokens(usage: {
  inputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}): number | undefined {
  const values = [usage.inputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0]
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) return undefined
  const total = values.reduce((sum, value) => sum + value, 0)
  return Number.isSafeInteger(total) ? total : undefined
}

/**
 * Fold only newly appended events into the durable task index.
 *
 * Context routing runs for every model step, so rescanning a 50K-event session
 * here would turn a short follow-up into repeated O(n) work. The Session log is
 * append-only; a per-session watermark lets the common path read only the new
 * range while still supporting restart/replay when the index is first created.
 */
function durableTaskIndex(
  session: Session,
  indexes: WeakMap<Session, DurableTaskIndex>,
  maxMessages: number,
): DurableTaskIndex {
  let index = indexes.get(session)
  if (index === undefined) {
    index = {
      consumedSeq: 0,
      activeTurn: undefined,
      firstUserMessageByTurn: new Map(),
      taskIdByTurn: new Map(),
      messageIdsByTurn: new Map(),
      messageIdsByToken: new Map(),
      truncatedTokens: new Set(),
      lexicalIndexSaturated: false,
    }
    indexes.set(session, index)
  }
  const endSeq = Number(session.seq)
  if (index.consumedSeq >= endSeq) return index
  for (const event of session.snapshotEvents(SessionLogOffset(index.consumedSeq), session.seq)) {
    if (event.type === 'turn/start') {
      index.activeTurn = event.data.turn
      if (!index.messageIdsByTurn.has(event.data.turn)) {
        index.messageIdsByTurn.set(event.data.turn, new Set())
      }
    }
    if (event.type === 'user/message' && index.activeTurn !== undefined
      && event.data.source.kind === 'user' && !index.firstUserMessageByTurn.has(index.activeTurn)) {
      index.firstUserMessageByTurn.set(index.activeTurn, String(event.data.id))
    }
    if (TASK_EVENT_TYPES.has(String(event.type))) {
      const data = (event as unknown as { data: unknown }).data as { id?: unknown; turn?: unknown }
      if (typeof data.id === 'string' && typeof data.turn === 'number') {
        index.taskIdByTurn.set(data.turn, data.id)
        if (!index.messageIdsByTurn.has(data.turn)) {
          index.messageIdsByTurn.set(data.turn, new Set())
        }
      }
    }
    if (index.activeTurn !== undefined) {
      const message = session.deriveEventMessage(event)
      if (message !== null) {
        for (const token of messageTokens(message)) {
          if (index.lexicalIndexSaturated && !index.messageIdsByToken.has(token)) continue
          if (!index.messageIdsByToken.has(token) && index.messageIdsByToken.size >= MAX_INDEXED_TOKENS) {
            index.lexicalIndexSaturated = true
            continue
          }
          const ids = index.messageIdsByToken.get(token) ?? new Set<string>()
          ids.add(String(message.id))
          while (ids.size > MAX_TOKEN_POSTING_MESSAGES) {
            const oldest = ids.values().next().value as string | undefined
            if (oldest === undefined) break
            ids.delete(oldest)
            index.truncatedTokens.add(token)
          }
          index.messageIdsByToken.set(token, ids)
        }
        const ids = index.messageIdsByTurn.get(index.activeTurn)
        if (ids !== undefined) {
          ids.add(String(message.id))
          while (ids.size > Math.max(1, Math.floor(maxMessages))) {
            const oldest = ids.values().next().value as string | undefined
            if (oldest === undefined) break
            ids.delete(oldest)
          }
        }
      }
    }
    if (event.type === 'turn/end' && event.data.turn === index.activeTurn) {
      if (!index.taskIdByTurn.has(event.data.turn)) {
        index.messageIdsByTurn.delete(event.data.turn)
        index.firstUserMessageByTurn.delete(event.data.turn)
      }
      index.activeTurn = undefined
    }
    if (TASK_EVENT_TYPES.has(String(event.type))) {
      const turns = [...index.taskIdByTurn.keys()].sort((left, right) => left - right)
      while (turns.length > MAX_INDEXED_TASK_TURNS) {
        const oldest = turns.shift()
        if (oldest === undefined) break
        index.taskIdByTurn.delete(oldest)
        index.messageIdsByTurn.delete(oldest)
        index.firstUserMessageByTurn.delete(oldest)
      }
    }
  }
  index.consumedSeq = endSeq
  return index
}

/** Return bounded lexical candidates without re-tokenizing the full history. */
function lexicalCandidates(
  index: DurableTaskIndex,
  terms: ReadonlySet<string>,
): ReadonlySet<string> | undefined {
  if (terms.size === 0) return undefined
  const candidates = new Set<string>()
  for (const term of terms) {
    // A capped posting list is only an optimization hint. Falling back keeps
    // routing semantics identical to the old exact scan for common terms.
    if (index.truncatedTokens.has(term)) return undefined
    if (index.lexicalIndexSaturated && !index.messageIdsByToken.has(term)) return undefined
    for (const id of index.messageIdsByToken.get(term) ?? []) candidates.add(id)
  }
  return candidates.size === 0 ? undefined : candidates
}

/** Recover the first direct user message of an open turn after a process restart. */
function durableTurnStartMessageId(
  session: Session,
  turn: number,
  indexes: WeakMap<Session, DurableTaskIndex>,
  maxMessages: number,
): string | undefined {
  return durableTaskIndex(session, indexes, maxMessages).firstUserMessageByTurn.get(turn)
}

/** Recover the latest prior durable task and its model-visible messages. */
function durableTaskRecall(
  session: Session,
  turn: number,
  indexes: WeakMap<Session, DurableTaskIndex>,
  maxMessages: number,
  existingIndex?: DurableTaskIndex,
): DurableTaskRecall | undefined {
  const index = existingIndex ?? durableTaskIndex(session, indexes, maxMessages)
  const priorTurns = [...index.taskIdByTurn.keys()].filter(candidate => candidate < turn).sort((left, right) => right - left)
  const priorTurn = priorTurns[0]
  const taskId = priorTurn === undefined ? undefined : index.taskIdByTurn.get(priorTurn)
  if (priorTurn === undefined || taskId === undefined) return undefined
  const allMessageIds = index.messageIdsByTurn.get(priorTurn) ?? new Set<string>()
  // A durable task may contain thousands of tool messages. A short follow-up
  // must never turn that entire task into an implicit full-history request.
  const messageIds = new Set([...allMessageIds].slice(-Math.max(1, Math.floor(maxMessages))))
  return messageIds.size === 0 ? undefined : { taskId, turn: priorTurn, messageIds }
}

/** Durable accounting for the exact message snapshot sent to the model. */
export interface ContextRouterAudit {
  turn: number
  step: number
  scope: 'fresh' | 'recent' | 'task' | 'full'
  /** Machine-readable evidence for this routing decision. */
  signal?: import('./router.ts').ContextRouteSignal
  reason: string
  inputMessages: number
  outputMessages: number
  droppedMessages: number
  estimatedInputTokens: number
  /** Estimated request input including tool schemas, after routing. */
  estimatedRequestTokens?: number
  /** Estimated context-window occupancy including the reserved output budget. */
  estimatedWindowTokens?: number
  /** Estimated amount by which the full request envelope exceeds the provider window. */
  requestOverflowTokens?: number
  /** Durable task selected as the source of continuation recall, when present. */
  taskId?: string
  /** Number of messages recalled from that durable task. */
  taskRecallMessages?: number
  /** True when this audit describes the post-adapter message projection. */
  finalPayload?: boolean
  /** Provider-neutral projections applied before adapter dispatch. */
  adapterProjection?: { files: boolean; images: boolean }
  budgetExceeded: boolean
  overflowTokens: number
  selectedMessageIds: string[]
  selectedMessageMeta?: ContextMessageAudit[]
  selectedMessageMetaOmitted?: number
  maxInputTokens?: number
  contextWindow?: number
  outputBudgetTokens?: number
  toolSchemaTokens?: number
  /** Provider/model route used for adaptive token calibration. */
  provider?: string
  model?: string
  /** Reserved window headroom applied to the message budget. */
  safetyReserveTokens?: number
  /** How the estimate was bounded for this request. */
  estimateBasis?: 'heuristic' | 'heuristic+reserve'
  /** Most recent provider-reported prompt size for this route, when available. */
  providerReportedInputTokens?: number
  /** Latest provider-minus-estimate delta used by calibration, when available. */
  calibrationDeltaTokens?: number
  /** Number of bounded samples used for this route's calibration. */
  calibrationSampleCount?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Audit of the request-context snapshot selected by the global router. */
    'context/router': {
      turn: number
      step: number
      scope: 'fresh' | 'recent' | 'task' | 'full'
      signal?: import('./router.ts').ContextRouteSignal
      reason: string
      inputMessages: number
      outputMessages: number
      droppedMessages: number
      estimatedInputTokens: number
      /** Estimated request input including tool schemas, after routing. */
      estimatedRequestTokens?: number
      /** Estimated context-window occupancy including the reserved output budget. */
      estimatedWindowTokens?: number
      /** Estimated amount by which the full request envelope exceeds the provider window. */
      requestOverflowTokens?: number
      /** Durable task selected as the source of continuation recall, when present. */
      taskId?: string
      /** Number of messages recalled from that durable task. */
      taskRecallMessages?: number
      /** True when this audit describes the post-adapter message projection. */
      finalPayload?: boolean
      /** Provider-neutral projections applied before adapter dispatch. */
      adapterProjection?: { files: boolean; images: boolean }
      budgetExceeded: boolean
      overflowTokens: number
      selectedMessageIds: string[]
      selectedMessageMeta?: ContextMessageAudit[]
      selectedMessageMetaOmitted?: number
      maxInputTokens?: number
      contextWindow?: number
      outputBudgetTokens?: number
      toolSchemaTokens?: number
      provider?: string
      model?: string
      safetyReserveTokens?: number
      estimateBasis?: 'heuristic' | 'heuristic+reserve'
      providerReportedInputTokens?: number
      calibrationDeltaTokens?: number
      calibrationSampleCount?: number
    }
    /** Bounded provider-token calibration state used by later context routes. */
    'context/calibration': {
      provider: string
      model: string
      samplesSeen: number
      deltas: number[]
      reserveTokens: number
      lastProviderInputTokens: number
      lastEstimatedRequestTokens: number
      lastDeltaTokens: number
    }
  }
}

/** Install the router after other request-context listeners have transformed their output. */
export function apply(ctx: Context, config: Config = {}): void {
  const enabled = config.enabled !== false
  const options = resolveRouterOptions(config)
  ctx.provide('contextRouter', { active: enabled })
  const openTurns = new WeakMap<Session, OpenTurnStart>()
  const durableIndexes = new WeakMap<Session, DurableTaskIndex>()
  const pendingFinalAudits = new WeakMap<Session, PendingContextAudit[]>()
  const pendingCalibrationSamples = new WeakMap<Session, Map<string, PendingCalibrationSample>>()
  const calibrationFolds = new WeakMap<Session, CalibrationFold>()
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      openTurns.set(session, { turn: event.data.turn })
    } else if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const openTurn = openTurns.get(session)
      if (openTurn !== undefined && openTurn.messageId === undefined) {
        openTurns.set(session, { ...openTurn, messageId: String(event.data.id) })
      }
    } else if (event.type === 'turn/end') {
      openTurns.delete(session)
      pendingFinalAudits.delete(session)
      pendingCalibrationSamples.delete(session)
    } else if (event.type === 'context/router') {
      const key = `${event.data.turn}:${event.data.step}`
      const pending = pendingCalibrationSamples.get(session) ?? new Map<string, PendingCalibrationSample>()
      pending.set(key, {
        ...(event.data.provider === undefined ? {} : { provider: event.data.provider }),
        ...(event.data.model === undefined ? {} : { model: event.data.model }),
        estimatedRequestTokens: event.data.estimatedRequestTokens ?? event.data.estimatedInputTokens,
      })
      pendingCalibrationSamples.set(session, pending)
    } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const key = `${event.data.turn}:${event.data.step}`
      const pending = pendingCalibrationSamples.get(session)
      const sample = pending?.get(key)
      const usage = event.type === 'assistant/message'
        ? event.data.usage
        : lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
      if (sample !== undefined && usage !== undefined) {
        const provider = sample.provider ?? (event.type === 'assistant/message' ? event.data.message.source.provider : undefined)
        const model = sample.model ?? (event.type === 'assistant/message' ? event.data.message.source.model : undefined)
        if (provider === undefined || model === undefined) return
        const routeKey = calibrationRouteKey(provider, model)
        const actual = providerPromptTokens(usage)
        if (routeKey !== undefined && actual !== undefined) {
          const fold = calibrationFold(session, calibrationFolds)
          const previous = calibrationState(fold, routeKey)
          const delta = actual - sample.estimatedRequestTokens
          const deltas = [...previous.deltas, delta].slice(-MAX_CALIBRATION_SAMPLES)
          const maxPositiveDelta = Math.max(0, ...deltas)
          const reserveTokens = Math.min(
            MAX_CALIBRATION_RESERVE_TOKENS,
            Math.max(0, Math.ceil(maxPositiveDelta * 1.25)),
          )
          const next: CalibrationState = {
            samplesSeen: previous.samplesSeen + 1,
            deltas,
            reserveTokens,
            lastProviderInputTokens: actual,
            lastEstimatedRequestTokens: sample.estimatedRequestTokens,
            lastDeltaTokens: delta,
          }
          fold.byRoute.set(routeKey, next)
          // Session observers run inside the append publication boundary and
          // cannot re-enter Session.append(). Defer the durable sample until
          // the current event has finished publishing.
          queueMicrotask(() => {
            try {
              session.append('context/calibration', {
                provider,
                model,
                samplesSeen: next.samplesSeen,
                deltas: [...next.deltas],
                reserveTokens: next.reserveTokens,
                lastProviderInputTokens: next.lastProviderInputTokens,
                lastEstimatedRequestTokens: next.lastEstimatedRequestTokens,
                lastDeltaTokens: next.lastDeltaTokens,
              }, { ignorable: true })
            } catch {
              // A disposed session may reject the deferred diagnostic append;
              // the in-memory reserve remains valid for the active request.
            }
          })
          pending?.delete(key)
        }
      }
    }
  })
  ctx.on('llm/request-ready', (options, projection) => {
    if (options.sessionId === undefined || options.purpose !== undefined) return
    const session = ctx.sessions.get(options.sessionId)
    if (session === undefined) return
    const pending = pendingFinalAudits.get(session)
    if (pending === undefined) return
    const messageIds = options.messages.map(message => String(message.id))
    const pendingIndex = pending.findIndex(item => sameMessageIds(item.audit.selectedMessageIds, messageIds))
    if (pendingIndex < 0) return
    const [matched] = pending.splice(pendingIndex, 1)
    if (pending.length === 0) pendingFinalAudits.delete(session)
    if (matched === undefined) return
    if (!projection.files && !projection.images) return
    const metadata = auditContextMessages(options.messages)
    const maxInputTokens = matched.audit.maxInputTokens
    const overflowTokens = maxInputTokens === undefined
      ? matched.audit.overflowTokens
      : Math.max(0, metadata.estimatedInputTokens - maxInputTokens)
    const estimatedRequestTokens = metadata.estimatedInputTokens + (matched.audit.toolSchemaTokens ?? 0)
    const estimatedWindowTokens = estimatedRequestTokens + (matched.audit.outputBudgetTokens ?? 0)
    const requestOverflowTokens = matched.audit.contextWindow === undefined
      ? 0
      : Math.max(0, estimatedWindowTokens + (matched.audit.safetyReserveTokens ?? 0) - matched.audit.contextWindow)
    session.append('context/router', {
      ...matched.audit,
      finalPayload: true,
      adapterProjection: projection,
      outputMessages: options.messages.length,
      droppedMessages: Math.max(0, matched.audit.inputMessages - options.messages.length),
      estimatedInputTokens: metadata.estimatedInputTokens,
      estimatedRequestTokens,
      estimatedWindowTokens,
      requestOverflowTokens,
      budgetExceeded: matched.audit.budgetExceeded || overflowTokens > 0 || requestOverflowTokens > 0,
      overflowTokens,
      selectedMessageIds: messageIds,
      selectedMessageMeta: metadata.selectedMessageMeta,
      selectedMessageMetaOmitted: metadata.selectedMessageMetaOmitted,
    }, { ignorable: true })
  }, { global: true, prepend: true })
  ctx.on('agent/request-context', async ({ agent, turn, step }, next) => {
    const transformed = await next()
    if (!enabled) return transformed
    const query = [...transformed].toReversed().find(message => message.source.kind === 'user')
    const queryText = query === undefined ? '' : messageText(query)
    const tracked = openTurns.get(agent.session)
    if (step === 1 || tracked?.turn !== turn) {
      const recoveredId = step > 1
        ? durableTurnStartMessageId(agent.session, turn, durableIndexes, options.taskMessages)
        : undefined
      const messageId = recoveredId ?? (query === undefined ? undefined : String(query.id))
      openTurns.set(agent.session, { turn, ...(messageId === undefined ? {} : { messageId }) })
    }
    // `step > 1` is an open-turn continuation: the durable history after the
    // turn's first direct user message is the live tool working set, not
    // unrelated cross-turn history. Route selection only applies at the turn
    // boundary.
    const openTurn = openTurns.get(agent.session)
    const startId = step > 1 && openTurn?.turn === turn ? openTurn.messageId : undefined
    const currentTurnStart = startId === undefined
      ? -1
      : transformed.findIndex(message => String(message.id) === startId)
    const route = step > 1
      ? { scope: 'task' as const, signal: 'open-turn' as const, reason: '当前 turn 工作集必须保留' }
      : resolveContextRouteForMessages(queryText, transformed, options.recentMessages)
    const taskIndex = route.scope === 'task'
      ? durableTaskIndex(agent.session, durableIndexes, options.taskMessages)
      : undefined
    const taskRecall = step === 1 && route.scope === 'task'
      ? durableTaskRecall(agent.session, turn, durableIndexes, options.taskMessages, taskIndex)
      : undefined
    const taskCandidateMessageIds = route.scope === 'task' && query !== undefined && taskIndex !== undefined
      ? lexicalCandidates(taskIndex, new Set(messageTokens(query)))
      : undefined
    const capacity = contextCapacity(agent.session)
    const calibrationKey = calibrationRouteKey(capacity.provider, capacity.model)
    const calibration = calibrationKey === undefined
      ? undefined
      : calibrationFold(agent.session, calibrationFolds).byRoute.get(calibrationKey)
    const personalAgent = ctx.get('personalAgent') as {
      contextBudget?: (session: Session) => number | undefined
    } | undefined
    const policyMaxTokens = personalAgent?.contextBudget?.(agent.session)
    const configuredMaxTokens = config.maxTokens === undefined
      ? policyMaxTokens ?? options.maxTokens
      : Math.min(options.maxTokens, policyMaxTokens ?? options.maxTokens)
    const safetyReserveTokens = capacity.contextWindow === undefined
      ? 0
      : Math.max(options.safetyMarginTokens, calibration?.reserveTokens ?? 0)
    const routedOptions = { ...options, maxTokens: configuredMaxTokens, safetyMarginTokens: safetyReserveTokens }
    const maxInputTokens = resolveContextBudget(routedOptions, capacity)
    const selection = selectContextMessages(
      transformed,
      route,
      { ...routedOptions, maxTokens: maxInputTokens },
      currentTurnStart,
      taskRecall?.messageIds,
      taskCandidateMessageIds,
    )
    const taskRecallMessages = taskRecall === undefined
      ? undefined
      : selection.messages.reduce((count, message) => taskRecall.messageIds.has(String(message.id)) ? count + 1 : count, 0)
    const estimatedRequestTokens = selection.estimatedInputTokens + (capacity.toolSchemaTokens ?? 0)
    const estimatedWindowTokens = estimatedRequestTokens + (capacity.outputBudgetTokens ?? 0)
    const requestOverflowTokens = capacity.contextWindow === undefined
      ? 0
      : Math.max(0, estimatedWindowTokens + safetyReserveTokens - capacity.contextWindow)
    const audit: ContextRouterAudit = {
      turn,
      step,
      scope: selection.scope,
      ...(selection.signal === undefined ? {} : { signal: selection.signal }),
      reason: selection.reason,
      inputMessages: transformed.length,
      outputMessages: selection.messages.length,
      droppedMessages: selection.droppedMessages,
      estimatedInputTokens: selection.estimatedInputTokens,
      estimatedRequestTokens,
      estimatedWindowTokens,
      requestOverflowTokens,
      ...capacity,
      safetyReserveTokens,
      estimateBasis: safetyReserveTokens > 0 ? 'heuristic+reserve' : 'heuristic',
      ...(calibration === undefined ? {} : {
        providerReportedInputTokens: calibration.lastProviderInputTokens,
        calibrationDeltaTokens: calibration.lastDeltaTokens,
        calibrationSampleCount: calibration.samplesSeen,
      }),
      ...(taskRecall === undefined || taskRecallMessages === undefined ? {} : {
        taskId: taskRecall.taskId,
        taskRecallMessages,
      }),
      budgetExceeded: selection.budgetExceeded || requestOverflowTokens > 0,
      overflowTokens: selection.overflowTokens,
      selectedMessageIds: selection.messages.map(message => String(message.id)),
      selectedMessageMeta: selection.selectedMessageMeta,
      selectedMessageMetaOmitted: selection.selectedMessageMetaOmitted,
      maxInputTokens,
    }
    agent.session.append('context/router', audit, { ignorable: true })
    const pending = pendingFinalAudits.get(agent.session) ?? []
    pending.push({ audit })
    while (pending.length > MAX_PENDING_FINAL_AUDITS) pending.shift()
    pendingFinalAudits.set(agent.session, pending)
    return selection.messages
  // Wrap the other request-context listeners so this selector runs on their
  // final output. The audit must describe the snapshot that reaches the loop,
  // not an intermediate history before mode-specific bounds are applied.
  }, { global: true, prepend: true })
}
