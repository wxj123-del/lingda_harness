import type { Message } from '@deepseek-ai/dsh-llm'

/** The amount of durable history selected for one request. */
export type ContextScope = 'fresh' | 'recent' | 'task' | 'full'

/** The deterministic policy used to classify one user request. */
export interface ContextRoute {
  scope: ContextScope
  reason: string
}

/** Bounds for the request snapshot. These values do not alter the Session log. */
export interface ContextRouterOptions {
  /** Number of trailing messages retained for ordinary follow-up requests. */
  recentMessages: number
  /** Number of trailing messages considered before task-term matching. */
  taskMessages: number
  /** Maximum estimated input tokens in one routed request snapshot. */
  maxTokens: number
}

/** The result and accounting produced by one context selection. */
export interface ContextSelection {
  messages: Message[]
  scope: ContextScope
  reason: string
  estimatedInputTokens: number
  droppedMessages: number
}

const DEFAULT_OPTIONS: ContextRouterOptions = {
  recentMessages: 16,
  taskMessages: 32,
  maxTokens: 24_000,
}

const FULL_RE = /(?:完整|全部|所有|全量|从头|历史记录|完整回顾|full history|entire history|all context)/iu
const FRESH_RE = /(?:新话题|新的问题|换个话题|换一个问题|不相关|无关|忽略上文|不用参考|new topic|unrelated|different question)/iu
const TASK_RE = /(?:继续|刚才|之前|上次|这个任务|当前任务|接着|恢复|回到|continue|previous|earlier|resume|this task)/iu

/** Extract model-visible text from one message for local routing heuristics. */
export function messageText(message: Message): string {
  return message.content.flatMap((block) => {
    if (block.type === 'text' || block.type === 'reasoning') return [block.text]
    if (block.type === 'tool-call') return [block.name, block.arguments]
    if (block.type === 'tool-result') return block.content.flatMap(inner => inner.type === 'text' ? [inner.text] : [])
    return []
  }).join('\n')
}

/** Resolve a scope from the user's wording without an embedding or model call. */
export function resolveContextRoute(query: string): ContextRoute {
  const normalized = query.trim()
  if (FULL_RE.test(normalized)) return { scope: 'full', reason: '用户明确要求完整历史' }
  if (FRESH_RE.test(normalized)) return { scope: 'fresh', reason: '用户明确开启新话题或声明与上文无关' }
  if (TASK_RE.test(normalized)) return { scope: 'task', reason: '用户引用了当前或之前的任务' }
  return { scope: 'recent', reason: '普通连续请求，仅保留近期上下文' }
}

/** Refine an unqualified request when its terms do not connect to recent history. */
export function resolveContextRouteForMessages(
  query: string,
  messages: readonly Message[],
  recentMessages: number,
): ContextRoute {
  const route = resolveContextRoute(query)
  if (route.scope !== 'recent') return route
  const queryTerms = new Set(tokens(query))
  if (queryTerms.size === 0) return route
  const directUsers = messages.filter(message => message.source.kind === 'user')
  const prior = directUsers.slice(0, -1).slice(-Math.max(1, recentMessages))
  const connected = prior.some(message => tokens(messageText(message)).some(term => queryTerms.has(term)))
  return connected
    ? route
    : { scope: 'fresh', reason: '当前请求与近期用户消息没有可观测的关键词联系' }
}

function tokens(text: string): string[] {
  const latin = text.toLocaleLowerCase().match(/[a-z0-9_./-]{2,}/gu) ?? []
  const cjk = text.match(/[\u3400-\u9fff]+/gu) ?? []
  const bigrams = cjk.flatMap(run => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)))
  return [...new Set([...latin, ...bigrams])]
}

function estimate(message: Message): number {
  return Math.max(1, Math.ceil(JSON.stringify(message).length / 4))
}

function isToolResult(message: Message): boolean {
  return message.source.kind === 'tool'
}

function isDirectUserMessage(message: Message): boolean {
  return message.source.kind === 'user'
}

function toolCallIds(message: Message): string[] {
  if (message.role !== 'assistant') return []
  return message.content.flatMap(block => block.type === 'tool-call' ? [String(block.id)] : [])
}

function toolResultId(message: Message): string | undefined {
  return isToolResult(message) && message.content[0]?.type === 'tool-result'
    ? String(message.content[0].toolCallId)
    : undefined
}

function closeToolPairs(messages: readonly Message[], selected: Set<number>): Set<number> {
  const owners = new Map<string, number>()
  const results = new Map<string, number>()
  messages.forEach((message, index) => {
    for (const id of toolCallIds(message)) owners.set(id, index)
    const resultId = toolResultId(message)
    if (resultId !== undefined) results.set(resultId, index)
  })
  const closed = new Set<number>(selected)
  for (const index of [...selected]) {
    const message = messages[index]
    if (message === undefined) {
      closed.delete(index)
      continue
    }
    const resultId = toolResultId(message)
    if (resultId !== undefined) {
      const owner = owners.get(resultId)
      if (owner === undefined || !selected.has(owner)) closed.delete(index)
      else closed.add(owner)
    }
    for (const callId of toolCallIds(message)) {
      const result = results.get(callId)
      if (result === undefined || !selected.has(result)) closed.delete(index)
      else closed.add(result)
    }
  }
  return closed
}

function trimToBudget(
  messages: readonly Message[],
  candidates: ReadonlySet<number>,
  mandatory: ReadonlySet<number>,
  maxTokens: number,
): Set<number> {
  const selected = new Set<number>(mandatory)
  let used = [...selected].reduce((sum, index) => {
    const message = messages[index]
    return message === undefined ? sum : sum + estimate(message)
  }, 0)
  if (used >= maxTokens) return selected
  const ownerByCall = new Map<string, number>()
  const resultByCall = new Map<string, number>()
  messages.forEach((message, index) => {
    for (const id of toolCallIds(message)) ownerByCall.set(id, index)
    const resultId = toolResultId(message)
    if (resultId !== undefined) resultByCall.set(resultId, index)
  })
  const visited = new Set<number>()
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!candidates.has(index) || selected.has(index) || visited.has(index)) continue
    const message = messages[index]
    if (message === undefined) continue
    const unit = new Set([index])
    const resultId = toolResultId(message)
    if (resultId !== undefined) {
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
      return candidate === undefined ? sum : sum + estimate(candidate)
    }, 0)
    if (used + cost > maxTokens) continue
    for (const member of unit) selected.add(member)
    used += cost
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
): ContextSelection {
  const options = { ...DEFAULT_OPTIONS, ...inputOptions }
  const currentUser = messages.findLastIndex(isDirectUserMessage)
  const system = new Set(messages.flatMap((message, index) => message.role === 'system' ? [index] : []))
  const mandatory = new Set(system)
  if (currentUser >= 0) mandatory.add(currentUser)
  const turnStart = Math.max(0, Math.min(currentTurnStart, messages.length))

  const selected = new Set<number>(mandatory)
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
    if (route.scope === 'task' && currentUser >= 0) {
      const current = messages[currentUser]
      const queryTokens = current === undefined ? new Set<string>() : new Set(tokens(messageText(current)))
      messages.forEach((message, index) => {
        if (index >= tailStart || system.has(index) || queryTokens.size === 0) return
        const matched = tokens(messageText(message)).some(token => queryTokens.has(token))
        if (matched) selected.add(index)
      })
    }
  }

  const closed = closeToolPairs(messages, selected)
  const budgeted = trimToBudget(messages, closed, mandatory, options.maxTokens)
  const bounded = closeToolPairs(messages, new Set([...budgeted].filter(index => closed.has(index))))
  const result = messages.filter((_message, index) => bounded.has(index))
  return {
    messages: result,
    scope: route.scope,
    reason: route.reason,
    estimatedInputTokens: result.reduce((sum, message) => sum + estimate(message), 0),
    droppedMessages: Math.max(0, messages.length - result.length),
  }
}

/** Merge optional configuration with conservative defaults. */
export function resolveRouterOptions(input: Partial<ContextRouterOptions> | undefined): ContextRouterOptions {
  return {
    recentMessages: Math.max(1, Math.floor(input?.recentMessages ?? DEFAULT_OPTIONS.recentMessages)),
    taskMessages: Math.max(1, Math.floor(input?.taskMessages ?? DEFAULT_OPTIONS.taskMessages)),
    maxTokens: Math.max(1, Math.floor(input?.maxTokens ?? DEFAULT_OPTIONS.maxTokens)),
  }
}
