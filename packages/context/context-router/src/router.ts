import type { Message } from '@deepseek-ai/dsh-llm'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import type { Session } from '@deepseek-ai/dsh-session'
import { estimateMessage, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter'

/** The amount of durable history selected for one request. */
export type ContextScope = 'fresh' | 'recent' | 'task' | 'full'

/** Stable message categories used by the final request snapshot audit. */
export type ContextMessageKind = 'system' | 'context' | 'user' | 'assistant' | 'tool' | 'unknown'

/** Machine-readable evidence that selected a context scope. */
export type ContextRouteSignal =
  | 'explicit-full'
  | 'explicit-fresh'
  | 'co-reference'
  | 'task-reference'
  | 'follow-up'
  | 'acknowledgement'
  | 'lexical-match'
  | 'open-turn'
  | 'unrelated'

/** The deterministic policy used to classify one user request. */
export interface ContextRoute {
  scope: ContextScope
  reason: string
  /** Optional for compatibility with callers that construct legacy routes. */
  signal?: ContextRouteSignal
  /** Deterministic confidence in the route classification, from 0 to 1. */
  confidence?: number
  /** True when the router had to fall back because no stronger relation was observable. */
  fallback?: boolean
}

/** Bounds for the request snapshot. These values do not alter the Session log. */
export interface ContextRouterOptions {
  /** Number of trailing messages retained for ordinary follow-up requests. */
  recentMessages: number
  /** Number of trailing messages considered before task-term matching. */
  taskMessages: number
  /** Number of messages recalled from the latest prior user turn for a co-reference query. */
  recallMessages: number
  /** Maximum fraction of the message budget available to non-active plugin context. */
  pluginContextRatio: number
  /** Maximum estimated input tokens in one routed request snapshot. */
  maxTokens: number
  /**
   * Reserved provider-window headroom for tokenizer/framing differences.
   * This reserve is applied only when the provider advertises a context window.
   */
  safetyMarginTokens: number
  /** Maximum characters kept inline for an older plain-text tool result. */
  toolResultMaxChars: number
  /** Number of newest tool-result messages protected from historical compaction. */
  toolResultRecentMessages: number
}

/** Provider capacity that constrains the message portion of one request. */
export interface ContextCapacity {
  /** Provider route that owns the current request metadata. */
  provider?: string
  /** Exact provider model that owns the current request metadata. */
  model?: string
  /** Combined input and output context window advertised by the provider. */
  contextWindow?: number
  /** Output reservation from the request header. */
  outputBudgetTokens?: number
  /** Tool schema reservation from the request header. */
  toolSchemaTokens?: number
}

/** The result and accounting produced by one context selection. */
export interface ContextSelection {
  messages: Message[]
  scope: ContextScope
  reason: string
  signal?: ContextRouteSignal
  confidence?: number
  fallback?: boolean
  /** Bounded lexical evidence for how much related user history survived routing. */
  routeEvidence?: ContextRouteEvidence
  /** Bounded accounting for tool-result compaction in this request snapshot. */
  toolAudit?: ContextToolAudit
  estimatedInputTokens: number
  droppedMessages: number
  /** Whether required messages alone or the selected snapshot exceed the budget. */
  budgetExceeded: boolean
  /** Estimated message-token overflow above the effective request budget. */
  overflowTokens: number
  /** Lightweight metadata for reconstructing the final routed snapshot in the UI. */
  selectedMessageMeta: ContextMessageAudit[]
  /** Number of selected messages omitted from the bounded metadata list. */
  selectedMessageMetaOmitted: number
}

/** Counts only; query text and message bodies are never duplicated in the audit. */
export interface ContextRouteEvidence {
  queryTerms: number
  candidateHistoryMessages: number
  selectedHistoryMessages: number
  matchedHistoryTerms: number
}

/** Counts and character bounds for tool context retained in one request. */
export interface ContextToolAudit {
  toolCallMessages: number
  toolResultMessages: number
  toolResultCharsBefore: number
  toolResultCharsAfter: number
  compactedToolResults: number
  deduplicatedToolResults: number
}

/** Bounded, model-visible metadata; message bodies are intentionally truncated. */
export interface ContextMessageAudit {
  id: string
  kind: ContextMessageKind
  sourceKind: string
  estimatedTokens: number
  preview: string
}

/** Bounded metadata and accounting for one exact model-visible message list. */
export interface ContextAuditMetadata {
  estimatedInputTokens: number
  selectedMessageMeta: ContextMessageAudit[]
  selectedMessageMetaOmitted: number
}

const DEFAULT_OPTIONS: ContextRouterOptions = {
  recentMessages: 16,
  taskMessages: 32,
  recallMessages: 8,
  pluginContextRatio: 0.25,
  maxTokens: 24_000,
  safetyMarginTokens: 256,
  toolResultMaxChars: 6_000,
  toolResultRecentMessages: 4,
}

const MAX_AUDIT_MESSAGES = 128

/** Resolve the effective message budget without exceeding provider capacity. */
export function resolveContextBudget(
  inputOptions: Partial<ContextRouterOptions> = {},
  capacity: ContextCapacity = {},
): number {
  const options = resolveRouterOptions(inputOptions)
  if (capacity.contextWindow === undefined) return options.maxTokens
  const available = capacity.contextWindow
    - (capacity.outputBudgetTokens ?? 0)
    - (capacity.toolSchemaTokens ?? 0)
    - Math.max(0, Math.floor(options.safetyMarginTokens))
  return Math.max(1, Math.min(options.maxTokens, available))
}

const FULL_RE = /(?:完整|全部|所有|全量|从头|历史记录|完整回顾|full history|entire history|all context)/iu
const FRESH_RE = /(?:新话题|新的问题|换个话题|换一个问题|不相关|无关|忽略上文|不用参考|new topic|unrelated|different question)/iu
const TASK_RE = /(?:继续|刚才|之前|上次|这个任务|当前任务|接着|恢复|回到|continue|previous|earlier|resume|this task)/iu
const FOLLOW_UP_RE = /(?:怎么回事|怎么办|改好了吗|修好了吗|完成了吗|结果呢|进展|还要多久|如何了|怎么样了|what happened|is it done|any update)/iu
const COREFERENCE_RE = /(?:它|其|前者|后者|上述|同上|前面提到|上面提到|刚才那个|之前那个|(?:这个|那个|该)(?:方案|文件|改动|错误|实现|提交|页面|配置|结果)|\b(?:it|that|this|the same)\b)/iu
/** Short acknowledgements continue the active exchange instead of starting a fresh topic. */
const ACKNOWLEDGEMENT_RE = /^(?:好|好的|收到|明白|明白了|了解|可以|行|没问题|继续|按这个来|就这样|ok|okay|got it|sounds good)[!！。\.、,，\s]*$/iu
/** High-frequency Chinese function phrases are not useful routing evidence. */
const ROUTING_STOPWORDS = new Set([
  '这个', '那个', '问题', '事情', '内容', '部分', '东西', '方面', '一下', '怎么', '如何',
  '可以', '需要', '现在', '已经', '还是', '然后', '以及', '关于', '帮我', '请问', '为什么',
])
const ROUTING_STOP_CHARS = new Set('个问题需要怎么解决一下关于请帮我为的了是和在有无')
const MESSAGE_TEXT_CACHE = new WeakMap<Message, string>()
const MESSAGE_TOKEN_CACHE = new WeakMap<Message, readonly string[]>()
const MESSAGE_ESTIMATE_CACHE = new WeakMap<Message, number>()
const TOOL_SCHEMA_ESTIMATE_CACHE = new WeakMap<object, number>()

function routeDecision(
  scope: ContextScope,
  signal: ContextRouteSignal,
  reason: string,
  confidence: number,
  fallback = false,
): ContextRoute {
  return {
    scope,
    signal,
    reason,
    confidence: Math.min(1, Math.max(0, confidence)),
    ...(fallback ? { fallback: true } : {}),
  }
}

/** Extract model-visible text from one message for local routing heuristics. */
export function messageText(message: Message): string {
  const cached = MESSAGE_TEXT_CACHE.get(message)
  if (cached !== undefined) return cached
  const text = message.content.flatMap((block) => {
    if (block.type === 'text' || block.type === 'reasoning') return [block.text]
    if (block.type === 'tool-call') return [block.name, block.arguments]
    if (block.type === 'tool-result') return block.content.flatMap(inner => inner.type === 'text' ? [inner.text] : [])
    return []
  }).join('\n')
  MESSAGE_TEXT_CACHE.set(message, text)
  return text
}

/** Estimate one immutable message once across routing, trimming, and audit passes. */
function estimatedMessageTokens(message: Message): number {
  const cached = MESSAGE_ESTIMATE_CACHE.get(message)
  if (cached !== undefined) return cached
  const estimated = estimateMessage(message)
  MESSAGE_ESTIMATE_CACHE.set(message, estimated)
  return estimated
}

/** Resolve a scope from the user's wording without an embedding or model call. */
export function resolveContextRoute(query: string): ContextRoute {
  const normalized = query.trim()
  if (FULL_RE.test(normalized)) return routeDecision('full', 'explicit-full', '用户明确要求完整历史', 1)
  if (FRESH_RE.test(normalized)) return routeDecision('fresh', 'explicit-fresh', '用户明确开启新话题或声明与上文无关', 1)
  if (COREFERENCE_RE.test(normalized)) return routeDecision('task', 'co-reference', '当前请求包含指代表达，需要召回相关任务上下文', 0.92)
  if (FOLLOW_UP_RE.test(normalized)) return routeDecision('task', 'follow-up', '当前请求是对近期任务的简短追问', 0.86)
  if (ACKNOWLEDGEMENT_RE.test(normalized)) return routeDecision('task', 'acknowledgement', '当前请求是对近期任务的确认或继续指令', 0.84)
  if (TASK_RE.test(normalized)) return routeDecision('task', 'task-reference', '用户引用了当前或之前的任务', 0.82)
  return routeDecision('recent', 'unrelated', '普通连续请求，仅保留近期上下文', 0.45, true)
}

/** Refine an unqualified request when its terms do not connect to recent history. */
export function resolveContextRouteForMessages(
  query: string,
  messages: readonly Message[],
  recentMessages: number,
): ContextRoute {
  const route = resolveContextRoute(query)
  if (route.scope !== 'recent') return route
  if (FOLLOW_UP_RE.test(query)) return routeDecision('task', 'follow-up', '当前请求是对近期任务的简短追问', 0.86)
  if (ACKNOWLEDGEMENT_RE.test(query.trim())) return routeDecision('task', 'acknowledgement', '当前请求是对近期任务的确认或继续指令', 0.84)
  const queryTerms = new Set(tokens(query))
  if (queryTerms.size === 0) {
    return query.trim() === ''
      ? route
      : routeDecision('fresh', 'unrelated', '当前请求只包含通用表达，无法建立可靠的历史联系', 0.88, true)
  }
  const prior: Message[] = []
  let seenUsers = 0
  // Walk backwards until the bounded recent-user window is filled. This keeps
  // an ordinary short request from scanning and tokenizing a 50K-message tail.
  for (let index = messages.length - 1; index >= 0 && seenUsers <= Math.max(1, recentMessages); index -= 1) {
    const message = messages[index]
    if (message === undefined || !isRoutingUserMessage(message)) continue
    if (seenUsers > 0) prior.unshift(message)
    seenUsers += 1
  }
  const connected = prior.some(message => messageTokens(message).some(term => queryTerms.has(term)))
  return connected
    ? routeDecision('recent', 'lexical-match', '当前请求与近期用户消息存在关键词联系', 0.74)
    : routeDecision('fresh', 'unrelated', '当前请求与近期用户消息没有可观测的关键词联系', 0.9, true)
}

function tokens(text: string): string[] {
  const latin = text.toLocaleLowerCase().match(/[a-z0-9_./-]{2,}/gu) ?? []
  const cjk = text.match(/[\u3400-\u9fff]+/gu) ?? []
  const bigrams = cjk.flatMap(run => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)))
  return [...new Set([...latin, ...bigrams])].filter(term => !ROUTING_STOPWORDS.has(term)
    && !Array.from(term).some(character => ROUTING_STOP_CHARS.has(character)))
}

/** Tokenize an immutable model message once; long tool chains reuse these arrays across routing passes. */
export function messageTokens(message: Message): readonly string[] {
  const cached = MESSAGE_TOKEN_CACHE.get(message)
  if (cached !== undefined) return cached
  const result = tokens(messageText(message))
  MESSAGE_TOKEN_CACHE.set(message, result)
  return result
}

/** Read the provider envelope limits recorded before request-context dispatch. */
export function contextCapacity(session: Pick<Session, 'requestContext' | 'requestHeader'>): ContextCapacity {
  const header = session.requestHeader()
  const route = session.requestContext()
  const contextWindow = route?.contextWindow
  let toolSchemaTokens = 0
  if (header !== undefined) {
    const cached = TOOL_SCHEMA_ESTIMATE_CACHE.get(header)
    if (cached !== undefined) {
      toolSchemaTokens = cached
    } else {
      const estimated = estimateToolsTokens(header)
      TOOL_SCHEMA_ESTIMATE_CACHE.set(header, estimated)
      toolSchemaTokens = estimated
    }
  }
  const outputBudgetTokens = header?.config.maxTokens
  return {
    ...(route?.provider === undefined ? {} : { provider: route.provider }),
    ...(route?.model === undefined ? {} : { model: route.model }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(outputBudgetTokens === undefined ? {} : { outputBudgetTokens }),
    toolSchemaTokens,
  }
}

function isToolResult(message: Message): boolean {
  return message.source.kind === 'tool'
}

/**
 * Messages that can anchor conversational routing.
 * Automated goal rounds use a user-role message with a `goal` source; treating
 * them as unrelated fresh requests would drop the preceding tool pair.
 */
export function isRoutingUserMessage(message: Message): boolean {
  return message.source.kind === 'user' || (message.source as { kind?: string }).kind === 'goal'
}

function contextMessageKind(message: Message): ContextMessageKind {
  if (message.role === 'system') return 'system'
  if (message.source.kind === 'tool') return 'tool'
  if (message.source.kind === 'plugin') return 'context'
  if (message.role === 'user') return 'user'
  if (message.role === 'assistant') return 'assistant'
  return 'unknown'
}

function contextMessagePreview(message: Message): string {
  const compact = messageText(message).replace(/\s+/gu, ' ').trim()
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact
}

/** Compare the current request with prior direct user messages after selection. */
function routeEvidence(
  messages: readonly Message[],
  selected: ReadonlySet<number>,
  currentUser: number,
  candidateMessageIndices: ReadonlySet<number> | undefined,
  maxHistoryMessages: number,
): ContextRouteEvidence | undefined {
  const current = messages[currentUser]
  if (current === undefined) return undefined
  const queryTerms = new Set(messageTokens(current))
  if (queryTerms.size === 0) {
    return { queryTerms: 0, candidateHistoryMessages: 0, selectedHistoryMessages: 0, matchedHistoryTerms: 0 }
  }
  // Keep this diagnostic bounded too: a 50K-message transcript must not turn
  // the observability pass into a second full-history lexical scan.
  const candidateIndices = new Set<number>(candidateMessageIndices)
  let seenUsers = 0
  for (let index = currentUser - 1; index >= 0 && seenUsers < Math.max(1, maxHistoryMessages); index -= 1) {
    const message = messages[index]
    if (message === undefined || !isRoutingUserMessage(message)) continue
    if (candidateMessageIndices === undefined) candidateIndices.add(index)
    seenUsers += 1
  }
  let candidateHistoryMessages = 0
  let selectedHistoryMessages = 0
  const matchedHistoryTerms = new Set<string>()
  messages.forEach((message, index) => {
    if (!candidateIndices.has(index)) return
    const matches = messageTokens(message).filter(term => queryTerms.has(term))
    if (matches.length === 0) return
    candidateHistoryMessages += 1
    if (!selected.has(index)) return
    selectedHistoryMessages += 1
    matches.forEach(term => matchedHistoryTerms.add(term))
  })
  return {
    queryTerms: queryTerms.size,
    candidateHistoryMessages,
    selectedHistoryMessages,
    matchedHistoryTerms: matchedHistoryTerms.size,
  }
}

function auditMessage(message: Message): ContextMessageAudit {
  return {
    id: String(message.id),
    kind: contextMessageKind(message),
    sourceKind: message.source.kind,
    estimatedTokens: estimatedMessageTokens(message),
    preview: contextMessagePreview(message),
  }
}

/** Build the same bounded audit representation for routed and adapter-ready payloads. */
export function auditContextMessages(messages: readonly Message[]): ContextAuditMetadata {
  const estimatedInputTokens = messages.reduce((sum, message) => sum + estimatedMessageTokens(message), 0)
  const allMessageMeta = messages.map(auditMessage)
  const selectedMessageMeta = allMessageMeta.length <= MAX_AUDIT_MESSAGES
    ? allMessageMeta
    : [...allMessageMeta.slice(0, 4), ...allMessageMeta.slice(-(MAX_AUDIT_MESSAGES - 4))]
  return {
    estimatedInputTokens,
    selectedMessageMeta,
    selectedMessageMetaOmitted: allMessageMeta.length - selectedMessageMeta.length,
  }
}

/** Prefer task-bearing conversation text over passive plugin context when budget is tight. */
function optionalMessagePriority(message: Message): number {
  if (message.source.kind === 'plugin') return 0
  if (message.source.kind === 'tool') return 1
  if (message.role === 'assistant') return 2
  if (message.role === 'user') return 3
  return 0
}

/** Compaction checkpoints carry durable task memory across routed turns. */
function isCompactionCheckpoint(message: Message): boolean {
  return isCompactCheckpointSource(message.source)
}

function isPassivePluginContext(message: Message): boolean {
  return message.source.kind === 'plugin' && !isCompactionCheckpoint(message)
}

function toolCallIds(message: Message): string[] {
  if (message.role !== 'assistant') return []
  return message.content.flatMap(block => block.type === 'tool-call' ? [String(block.id)] : [])
}

function toolResultIds(message: Message): string[] {
  if (!isToolResult(message)) return []
  return message.content.flatMap(block => block.type === 'tool-result' ? [String(block.toolCallId)] : [])
}

const SPILL_NOTICE = 'Full formatted result stored at:'
const DUPLICATE_TOOL_RESULT_TEXT = '[重复工具结果已省略；请使用首次结果]'

function toolResultText(message: Message): string {
  return message.content.flatMap(block => block.type === 'tool-result'
    ? block.content.flatMap(inner => inner.type === 'text' ? [inner.text] : [])
    : []).join('')
}

function isSpilledToolResult(message: Message): boolean {
  const text = toolResultText(message)
  return text.includes(SPILL_NOTICE) && text.endsWith(')')
}

function compactText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = `\n...[旧工具结果已压缩，省略 ${text.length - maxChars} 个字符]...\n`
  if (marker.length >= maxChars) return marker.slice(0, maxChars)
  const available = Math.max(0, maxChars - marker.length)
  const head = Math.ceil(available / 2)
  const tail = Math.floor(available / 2)
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(-tail) : ''}`
}

function replaceToolResultText(message: Message, replacement: string | ((text: string) => string)): Message {
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type !== 'tool-result' || block.content.some(inner => inner.type !== 'text')) return block
      const text = block.content.map(inner => inner.type === 'text' ? inner.text : '').join('')
      return { ...block, content: [{ type: 'text', text: typeof replacement === 'function' ? replacement(text) : replacement }] }
    }),
  }
}

function toolResultFingerprint(message: Message): string | undefined {
  if (isSpilledToolResult(message)) return undefined
  const blocks = message.content.flatMap(block => block.type === 'tool-result' ? [block] : [])
  if (blocks.length === 0 || blocks.some(block => block.content.some(inner => inner.type !== 'text'))) return undefined
  return JSON.stringify(blocks.map(block => ({
    isError: block.isError === true,
    content: block.content.map(inner => inner.type === 'text' ? inner.text : ''),
  })))
}

function compactToolResults(messages: readonly Message[], options: ContextRouterOptions): {
  messages: Message[]
  audit?: ContextToolAudit
} {
  const toolCallMessages = messages.filter(message => toolCallIds(message).length > 0).length
  const resultIndices = messages.flatMap((message, index) => toolResultIds(message).length > 0 ? [index] : [])
  if (toolCallMessages === 0 && resultIndices.length === 0) return { messages: [...messages] }

  const recentCount = Math.max(0, Math.floor(options.toolResultRecentMessages))
  const protectedIndices = new Set(recentCount === 0 ? [] : resultIndices.slice(-recentCount))
  const seen = new Set<string>()
  let compactedToolResults = 0
  let deduplicatedToolResults = 0
  let toolResultCharsBefore = 0
  let toolResultCharsAfter = 0
  const resultIndexSet = new Set(resultIndices)
  const transformedByIndex = new Map<number, Message>()
  for (const index of [...resultIndices].reverse()) {
    const message = messages[index]
    if (message === undefined) continue
    const before = toolResultText(message)
    toolResultCharsBefore += before.length
    const fingerprint = toolResultFingerprint(message)
    const duplicate = fingerprint !== undefined && seen.has(fingerprint) && !protectedIndices.has(index)
    if (fingerprint !== undefined) seen.add(fingerprint)
    let transformed = message
    if (duplicate) {
      transformed = replaceToolResultText(message, DUPLICATE_TOOL_RESULT_TEXT)
      deduplicatedToolResults += 1
    } else if (!protectedIndices.has(index) && !isSpilledToolResult(message) && before.length > options.toolResultMaxChars) {
      transformed = replaceToolResultText(message, text => compactText(text, Math.max(64, Math.floor(options.toolResultMaxChars))))
      compactedToolResults += 1
    }
    toolResultCharsAfter += toolResultText(transformed).length
    transformedByIndex.set(index, transformed)
  }
  const next = messages.map((message, index) => resultIndexSet.has(index)
    ? transformedByIndex.get(index) ?? message
    : message)
  return {
    messages: next,
    audit: {
      toolCallMessages,
      toolResultMessages: resultIndices.length,
      toolResultCharsBefore,
      toolResultCharsAfter,
      compactedToolResults,
      deduplicatedToolResults,
    },
  }
}

function closeToolPairs(messages: readonly Message[], selected: Set<number>): Set<number> {
  const owners = new Map<string, number>()
  const results = new Map<string, number>()
  messages.forEach((message, index) => {
    for (const id of toolCallIds(message)) owners.set(id, index)
    for (const resultId of toolResultIds(message)) results.set(resultId, index)
  })
  const closed = new Set<number>(selected)
  let changed = true
  while (changed) {
    changed = false
    for (const index of [...closed]) {
      const message = messages[index]
      if (message === undefined) {
        closed.delete(index)
        changed = true
        continue
      }
      const resultOwners = toolResultIds(message).map(resultId => owners.get(resultId))
      const callResults = toolCallIds(message).map(callId => results.get(callId))
      if (resultOwners.some(owner => owner === undefined || !closed.has(owner))
        || callResults.some(result => result === undefined || !closed.has(result))) {
        closed.delete(index)
        changed = true
      }
    }
  }
  return closed
}

function trimToBudget(
  messages: readonly Message[],
  candidates: ReadonlySet<number>,
  mandatory: ReadonlySet<number>,
  maxTokens: number,
  priorityStart = -1,
  pluginContextBudget = Number.POSITIVE_INFINITY,
  preferred: ReadonlySet<number> = new Set(),
): Set<number> {
  const selected = new Set<number>(mandatory)
  let used = [...selected].reduce((sum, index) => {
    const message = messages[index]
    return message === undefined ? sum : sum + estimatedMessageTokens(message)
  }, 0)
  if (used >= maxTokens) return selected
  const ownerByCall = new Map<string, number>()
  const resultByCall = new Map<string, number>()
  messages.forEach((message, index) => {
    for (const id of toolCallIds(message)) ownerByCall.set(id, index)
    for (const resultId of toolResultIds(message)) resultByCall.set(resultId, index)
  })
  const visited = new Set<number>()
  let priorityBlocked = false
  let usedPluginContext = [...selected].reduce((sum, index) => {
    const message = messages[index]
    return message !== undefined && isPassivePluginContext(message) ? sum + estimatedMessageTokens(message) : sum
  }, 0)
  const candidateIndices = [...candidates]
    .filter(index => !selected.has(index))
    .sort((left, right) => {
      const leftOpenTurn = priorityStart >= 0 && left >= priorityStart
      const rightOpenTurn = priorityStart >= 0 && right >= priorityStart
      if (leftOpenTurn !== rightOpenTurn) return leftOpenTurn ? -1 : 1
      const leftPreferred = preferred.has(left)
      const rightPreferred = preferred.has(right)
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1
      const priority = optionalMessagePriority(messages[right] as Message) - optionalMessagePriority(messages[left] as Message)
      return priority !== 0 ? priority : right - left
    })
  for (const index of candidateIndices) {
    if (!candidates.has(index) || selected.has(index) || visited.has(index)) continue
    // An open turn is the active working set. If one of its atomic units cannot
    // fit, do not spend the remaining budget on older turns instead.
    if (priorityStart >= 0 && index < priorityStart && priorityBlocked) continue
    const message = messages[index]
    if (message === undefined) continue
    const unit = new Set([index])
    for (const resultId of toolResultIds(message)) {
      const owner = ownerByCall.get(resultId)
      if (owner !== undefined && candidates.has(owner)) unit.add(owner)
    }
    for (const callId of toolCallIds(message)) {
      const result = resultByCall.get(callId)
      if (result !== undefined && candidates.has(result)) unit.add(result)
    }
    for (const member of unit) visited.add(member)
    const cost = [...unit].reduce((sum, member) => {
      const candidate = messages[member]
      return candidate === undefined ? sum : sum + estimatedMessageTokens(candidate)
    }, 0)
    const priorityUnit = priorityStart >= 0 && [...unit].some(member => member >= priorityStart)
    const pluginCost = [...unit].reduce((sum, member) => {
      const candidate = messages[member]
      return candidate !== undefined && isPassivePluginContext(candidate) ? sum + estimatedMessageTokens(candidate) : sum
    }, 0)
    if (!priorityUnit && usedPluginContext + pluginCost > pluginContextBudget) continue
    if (used + cost > maxTokens) {
      if (priorityUnit) priorityBlocked = true
      continue
    }
    for (const member of unit) selected.add(member)
    used += cost
    usedPluginContext += pluginCost
  }
  return selected
}

/**
 * Select a request snapshot while preserving system messages and tool pairs.
 * @param messages - The transformed model-visible history.
 * @param route - The cross-turn routing decision.
 * @param inputOptions - Optional message and token bounds.
 * @param currentTurnStart - Index of the open turn's first message, or `-1`
 * when history routing may consider every non-mandatory message.
 * @param taskMessageIds - Bounded IDs recalled from the latest durable task.
 * @param taskCandidateMessageIds - Optional indexed candidates for lexical task matching.
 * @returns The selected messages and routing accounting.
 */
export function selectContextMessages(
  messages: readonly Message[],
  route: ContextRoute,
  inputOptions: Partial<ContextRouterOptions> = {},
  /**
   * First message belonging to the open turn. Messages from this index onward
   * stay in the working set while older turns remain subject to routing.
   */
  currentTurnStart = -1,
  /** Message IDs belonging to the durable prior task selected for a continuation. */
  taskMessageIds?: ReadonlySet<string>,
  /** Message IDs returned by the incremental lexical index for task matching. */
  taskCandidateMessageIds?: ReadonlySet<string>,
): ContextSelection {
  const options = resolveRouterOptions(inputOptions)
  const currentUser = messages.findLastIndex(isRoutingUserMessage)
  const system = new Set(messages.flatMap((message, index) => message.role === 'system' ? [index] : []))
  const mandatory = new Set(system)
  if (currentUser >= 0) mandatory.add(currentUser)
  if (route.scope !== 'fresh') {
    const checkpoint = messages.findLastIndex(isCompactionCheckpoint)
    if (checkpoint >= 0) mandatory.add(checkpoint)
  }
  const turnStart = Math.max(0, Math.min(currentTurnStart, messages.length))

  const selected = new Set<number>(mandatory)
  const evidenceCandidateIndices = new Set<number>()
  if (currentTurnStart >= 0) {
    for (let index = turnStart; index < messages.length; index += 1) selected.add(index)
  }
  if (route.scope === 'full') {
    messages.forEach((_message, index) => selected.add(index))
  } else if (route.scope === 'fresh') {
    messages.forEach((message, index) => {
      if (index > currentUser && message.source.kind === 'plugin') selected.add(index)
    })
  } else {
    const limit = route.scope === 'task' ? options.taskMessages : options.recentMessages
    const tailStart = Math.max(0, messages.length - limit)
    for (let index = tailStart; index < messages.length; index += 1) selected.add(index)
    if ((route.scope === 'task' || route.signal === 'lexical-match') && currentUser >= 0) {
      if (route.scope === 'task' && taskMessageIds !== undefined) {
        const boundedTaskMessageIds = new Set([...taskMessageIds].slice(-Math.max(1, Math.floor(options.taskMessages))))
        messages.forEach((message, index) => {
          if (boundedTaskMessageIds.has(String(message.id))) selected.add(index)
        })
      }
      const current = messages[currentUser]
      const queryTokens = current === undefined ? new Set<string>() : new Set(messageTokens(current))
      if (current !== undefined && COREFERENCE_RE.test(messageText(current))) {
        const priorUser = messages.findLastIndex((message, index) => index < currentUser && isRoutingUserMessage(message))
        if (priorUser >= 0) {
          const recallEnd = Math.min(currentUser, priorUser + options.recallMessages)
          for (let index = priorUser; index < recallEnd; index += 1) selected.add(index)
        }
      }
      messages.forEach((message, index) => {
        if (index >= tailStart || system.has(index) || queryTokens.size === 0) return
        if (taskCandidateMessageIds !== undefined
          && message.source.kind !== 'plugin'
          && !taskCandidateMessageIds.has(String(message.id))) return
        const matched = messageTokens(message).some(token => queryTokens.has(token))
        if (matched) {
          selected.add(index)
          evidenceCandidateIndices.add(index)
        }
      })
    }
  }

  const closed = closeToolPairs(messages, selected)
  const budgeted = trimToBudget(
    messages,
    closed,
    mandatory,
    options.maxTokens,
    currentTurnStart,
    Math.floor(options.maxTokens * options.pluginContextRatio),
    evidenceCandidateIndices,
  )
  const bounded = closeToolPairs(messages, new Set([...budgeted].filter(index => closed.has(index))))
  const selectedMessages = messages.filter((_message, index) => bounded.has(index))
  const compacted = compactToolResults(selectedMessages, options)
  const result = compacted.messages
  const metadata = auditContextMessages(result)
  const estimatedInputTokens = metadata.estimatedInputTokens
  const overflowTokens = Math.max(0, estimatedInputTokens - options.maxTokens)
  const evidence = routeEvidence(
    messages,
    bounded,
    currentUser,
    evidenceCandidateIndices.size === 0 ? undefined : evidenceCandidateIndices,
    options.taskMessages,
  )
  return {
    messages: result,
    scope: route.scope,
    reason: route.reason,
    ...(route.signal === undefined ? {} : { signal: route.signal }),
    ...(route.confidence === undefined ? {} : { confidence: route.confidence }),
    ...(route.fallback === undefined ? {} : { fallback: route.fallback }),
    ...(evidence === undefined ? {} : { routeEvidence: evidence }),
    ...(compacted.audit === undefined ? {} : { toolAudit: compacted.audit }),
    estimatedInputTokens,
    droppedMessages: Math.max(0, messages.length - result.length),
    budgetExceeded: overflowTokens > 0,
    overflowTokens,
    selectedMessageMeta: metadata.selectedMessageMeta,
    selectedMessageMetaOmitted: metadata.selectedMessageMetaOmitted,
  }
}

/** Merge optional configuration with conservative defaults. */
export function resolveRouterOptions(input: Partial<ContextRouterOptions> | undefined): ContextRouterOptions {
  const finite = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) ? value : fallback
  return {
    recentMessages: Math.max(1, Math.floor(finite(input?.recentMessages, DEFAULT_OPTIONS.recentMessages))),
    taskMessages: Math.max(1, Math.floor(finite(input?.taskMessages, DEFAULT_OPTIONS.taskMessages))),
    recallMessages: Math.max(1, Math.floor(finite(input?.recallMessages, DEFAULT_OPTIONS.recallMessages))),
    pluginContextRatio: Math.min(1, Math.max(0, finite(input?.pluginContextRatio, DEFAULT_OPTIONS.pluginContextRatio))),
    maxTokens: Math.max(1, Math.floor(finite(input?.maxTokens, DEFAULT_OPTIONS.maxTokens))),
    safetyMarginTokens: Math.max(0, Math.floor(finite(input?.safetyMarginTokens, DEFAULT_OPTIONS.safetyMarginTokens))),
    toolResultMaxChars: Math.max(64, Math.floor(finite(input?.toolResultMaxChars, DEFAULT_OPTIONS.toolResultMaxChars))),
    toolResultRecentMessages: Math.max(0, Math.floor(finite(input?.toolResultRecentMessages, DEFAULT_OPTIONS.toolResultRecentMessages))),
  }
}
