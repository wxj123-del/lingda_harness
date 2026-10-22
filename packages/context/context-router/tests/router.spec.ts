import { describe, expect, it } from 'vitest'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import { estimateMessage, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter'
import { contextCapacity, messageText, resolveContextBudget, resolveContextRoute, resolveContextRouteForMessages, selectContextMessages } from '../src/router.ts'

const user = (text: string): Message => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
describe('context router', () => {
  it('reserves output and tool schemas inside the provider context window', () => {
    expect(resolveContextBudget({ maxTokens: 24_000 }, {
      contextWindow: 8_192, outputBudgetTokens: 2_048, toolSchemaTokens: 1_024,
    })).toBe(4_864)
    expect(resolveContextBudget({ maxTokens: 24_000, safetyMarginTokens: 0 }, {
      contextWindow: 8_192, outputBudgetTokens: 2_048, toolSchemaTokens: 1_024,
    })).toBe(5_120)
    expect(resolveContextBudget({ maxTokens: 24_000 }, { contextWindow: 128_000 })).toBe(24_000)
    expect(resolveContextBudget({ maxTokens: 24_000 })).toBe(24_000)
  })

  it('reads provider capacity from the durable request header', () => {
    const capacity = contextCapacity({
      requestContext: () => ({ provider: 'test', model: 'test', contextWindow: 8_192 }),
      requestHeader: () => ({
        config: { provider: 'test', model: 'test', maxTokens: 2_048 },
        tools: [{ name: 'lookup', description: 'look up', parameters: {} }],
      }),
    })
    expect(capacity.contextWindow).toBe(8_192)
    expect(capacity.outputBudgetTokens).toBe(2_048)
    expect(capacity.toolSchemaTokens).toBeGreaterThan(0)
  })

  it('uses the token-meter estimator for routed messages and tool schemas', () => {
    const messages = [createSystemMessage('system', 'system prompt'), user('current request')]
    const selection = selectContextMessages(messages, { scope: 'full', reason: 'test' })
    expect(selection.estimatedInputTokens).toBe(messages.reduce((total, message) => total + estimateMessage(message), 0))
    const header = {
      config: { provider: 'test', model: 'test' },
      tools: [{ name: 'lookup', description: 'look up', parameters: {} }],
    }
    expect(contextCapacity({
      requestContext: () => ({ provider: 'test', model: 'test', contextWindow: 8_192 }),
      requestHeader: () => header,
    }).toolSchemaTokens).toBe(estimateToolsTokens(header))
  })

  it('classifies explicit routing language', () => {
    expect(resolveContextRoute('今天天气怎么样？')).toMatchObject({ scope: 'recent', signal: 'unrelated', fallback: true })
    expect(resolveContextRoute('继续刚才的旧任务')).toMatchObject({ scope: 'task', signal: 'task-reference', confidence: 0.82 })
    expect(resolveContextRoute('换个话题，问个无关的问题')).toMatchObject({ scope: 'fresh', signal: 'explicit-fresh', confidence: 1 })
    expect(resolveContextRoute('请完整回顾全部历史')).toMatchObject({ scope: 'full', signal: 'explicit-full', confidence: 1 })
  })

  it('treats an unrelated unqualified request as fresh', () => {
    const messages = [user('继续实现 context router'), user('继续修复测试')]
    expect(resolveContextRouteForMessages('今天天气怎么样？', messages, 4)).toMatchObject({ scope: 'fresh', signal: 'unrelated', confidence: 0.9, fallback: true })
    expect(resolveContextRouteForMessages('context router 测试失败了', messages, 4)).toMatchObject({ scope: 'recent', signal: 'lexical-match', confidence: 0.74 })
  })

  it('does not treat generic Chinese phrases as a task connection', () => {
    const messages = [user('这个问题需要继续处理旧的登录任务'), user('这个问题怎么解决')]
    expect(resolveContextRouteForMessages('这个问题怎么解决', messages, 4).scope).toBe('fresh')
  })

  it('keeps short status follow-ups attached to the recent task', () => {
    const messages = [user('继续处理旧的登录任务'), user('改好了吗')]
    expect(resolveContextRouteForMessages('改好了吗', messages, 4)).toMatchObject({ scope: 'task', signal: 'follow-up' })
  })

  it('keeps short acknowledgements attached to the recent task', () => {
    const messages = [user('继续处理旧的登录任务'), user('好的')]
    expect(resolveContextRouteForMessages('好的', messages, 4)).toMatchObject({ scope: 'task', signal: 'acknowledgement' })
  })

  it('routes co-reference wording to task context and recalls the prior turn', () => {
    const prior = user('实现飞书链接的消息渲染')
    const answer = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'text', text: '已完成消息格式处理' }],
    })
    const current = user('它现在能用了吗')
    const messages = [prior, answer, current]
    const route = resolveContextRouteForMessages('它现在能用了吗', messages, 1)
    expect(route).toMatchObject({ scope: 'task', signal: 'co-reference' })
    const result = selectContextMessages(messages, route, { taskMessages: 1, recallMessages: 2 })
    expect(result.messages).toEqual([prior, answer, current])
  })

  it('anchors automated goal rounds to the prior tool history', () => {
    const prior = user('创建一个需要持续跟进的目标')
    const call = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: ToolCallId('goal-call'), name: 'create_goal', arguments: '{}' }],
    })
    const result = createToolResultMessage({
      callId: ToolCallId('goal-call'),
      isError: false,
      content: [{ type: 'text', text: '{"goal":{"id":"goal-1"}}' }],
    })
    const round = createUserMessage({
      source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 } as never,
      content: [{ type: 'text', text: '<goal_round>Continue working toward the objective.</goal_round>' }],
    })
    const messages = [prior, call, result, round]
    const route = resolveContextRouteForMessages(messageText(round), messages, 4)
    const selection = selectContextMessages(messages, route, { taskMessages: 8 })

    expect(route.scope).toBe('task')
    expect(selection.messages).toEqual(messages)
  })

  it('drops old ordinary history for a fresh question but keeps system and current user', () => {
    const messages = [createSystemMessage('system', 'test'), user('旧问题'), user('今天天气怎么样？')]
    const result = selectContextMessages(messages, resolveContextRoute('换个话题').scope === 'fresh'
      ? resolveContextRoute('换个话题')
      : { scope: 'fresh', reason: 'test' })
    expect(result.messages).toEqual([messages[0], messages[2]])
  })

  it('keeps the latest durable compaction checkpoint for connected routes', () => {
    const checkpoint = createUserMessage({
      source: compactCheckpointSource(CompactionId('router-checkpoint')),
      content: [{ type: 'text', text: '持久任务摘要：已完成路由器实现' }],
    })
    const messages = [checkpoint, user('近期无关消息'), user('继续处理当前任务')]
    const recent = selectContextMessages(messages, { scope: 'recent', reason: 'test' }, { recentMessages: 1 })
    expect(recent.messages).toEqual([checkpoint, messages[2]])
    const fresh = selectContextMessages(messages, { scope: 'fresh', reason: 'test' })
    expect(fresh.messages).toEqual([messages[2]])
  })

  it('retains matching task history beyond the recent tail', () => {
    const messages = [user('实现 context router 的接口'), ...Array.from({ length: 5 }, (_, i) => user(`无关轮次 ${i}`)), user('继续 context router 任务')]
    const result = selectContextMessages(messages, { scope: 'task', reason: 'test' }, { taskMessages: 2 })
    expect(result.messages).toContain(messages[0])
    expect(result.messages.at(-1)).toBe(messages.at(-1))
  })

  it('adaptively recalls matching history for a lexical recent route', () => {
    const matching = user('context router 的置信度策略需要测试')
    const messages = [matching, ...Array.from({ length: 5 }, (_, i) => user(`无关轮次 ${i}`)), user('context router 置信度测试失败了')]
    const route = resolveContextRouteForMessages('context router 置信度测试失败了', messages, 8)
    const result = selectContextMessages(messages, route, { recentMessages: 2, taskMessages: 8 })

    expect(route).toMatchObject({ scope: 'recent', signal: 'lexical-match' })
    expect(result.messages).toContain(matching)
    expect(result.routeEvidence).toMatchObject({ candidateHistoryMessages: 1, selectedHistoryMessages: 1 })
  })

  it('propagates confidence and fallback into selection audit data', () => {
    const route = resolveContextRouteForMessages('今天天气怎么样？', [user('修复 context router')], 4)
    const result = selectContextMessages([user('修复 context router'), user('今天天气怎么样？')], route)
    expect(result).toMatchObject({ confidence: 0.9, fallback: true })
  })

  it('accepts incremental lexical candidates without changing bounded task selection', () => {
    const matching = user('实现 context router 的接口')
    const unrelated = user('无关轮次')
    const current = user('继续 context router 任务')
    const result = selectContextMessages(
      [matching, unrelated, current],
      { scope: 'task', reason: 'indexed task match' },
      { taskMessages: 1 },
      -1,
      undefined,
      new Set([String(matching.id)]),
    )
    expect(result.messages).toEqual([matching, current])
  })

  it('reports related-history candidates and retained matches', () => {
    const matching = user('实现 context router 的接口')
    const unrelated = user('天气预报')
    const current = user('继续 context router 任务')
    const result = selectContextMessages(
      [matching, unrelated, current],
      { scope: 'task', signal: 'lexical-match', reason: 'indexed task match' },
      { taskMessages: 1 },
    )
    expect(result.routeEvidence).toMatchObject({
      queryTerms: expect.any(Number), candidateHistoryMessages: 1,
      selectedHistoryMessages: 1, matchedHistoryTerms: expect.any(Number),
    })
  })

  it('bounds durable task recall instead of turning a short continuation into full history', () => {
    const taskMessages = Array.from({ length: 12 }, (_, i) => user(`任务阶段 ${i}`))
    const current = user('好的')
    const messages = [...taskMessages, current]
    const recalledIds = new Set(taskMessages.map(message => String(message.id)))
    const result = selectContextMessages(
      messages,
      { scope: 'task', reason: 'durable continuation' },
      { taskMessages: 3, recentMessages: 1 },
      -1,
      recalledIds,
    )

    expect(result.messages).not.toContain(taskMessages[0])
    expect(result.messages).not.toContain(taskMessages[8])
    expect(result.messages).toEqual([...taskMessages.slice(-3), current])
  })

  it('prefers task-bearing conversation messages over plugin context under pressure', () => {
    const history = user('用户明确提出的登录任务约束')
    const pluginContext = createUserMessage({
      source: { kind: 'plugin', plugin: 'knowledge-auto-retrieval' },
      content: [{ type: 'text', text: '知识库补充内容 '.repeat(80) }],
    })
    const current = user('继续登录任务')
    const result = selectContextMessages(
      [history, pluginContext, current],
      { scope: 'full', reason: 'test' },
      { maxTokens: estimateMessage(history) + estimateMessage(current) + 1 },
    )
    expect(result.messages).toContain(history)
    expect(result.messages).not.toContain(pluginContext)
  })

  it('caps passive plugin context separately from the general message budget', () => {
    const history = user('用户明确提出的任务历史')
    const pluginContext = createUserMessage({
      source: { kind: 'plugin', plugin: 'knowledge-auto-retrieval' },
      content: [{ type: 'text', text: '检索补充内容 '.repeat(40) }],
    })
    const current = user('当前任务请求')
    const maxTokens = estimateMessage(history) + estimateMessage(pluginContext) + estimateMessage(current) + 1
    const result = selectContextMessages(
      [history, pluginContext, current],
      { scope: 'full', reason: 'test' },
      { maxTokens, pluginContextRatio: 0.1 },
    )
    expect(result.messages).toContain(history)
    expect(result.messages).toContain(current)
    expect(result.messages).not.toContain(pluginContext)
  })

  it('keeps tool calls and results together', () => {
    const id = ToolCallId('router-call')
    const assistant = createAssistantMessage({ source: { provider: 'test', model: 'test' }, content: [{ type: 'tool-call', id, name: 'lookup', arguments: '{}' }] })
    const result = createToolResultMessage({ callId: id, isError: false, content: [{ type: 'text', text: 'ok' }] })
    const messages = [user('old'), assistant, result, user('current')]
    const selected = selectContextMessages(messages, { scope: 'recent', reason: 'test' }, { recentMessages: 1 })
    expect(selected.messages).toEqual([messages[3]])
    const retained = selectContextMessages(messages, { scope: 'full', reason: 'test' })
    expect(retained.messages).toEqual(messages)
  })

  it('keeps every block in a multi-result tool message tied to its calls', () => {
    const first = ToolCallId('multi-result-first')
    const second = ToolCallId('multi-result-second')
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [
        { type: 'tool-call', id: first, name: 'lookup', arguments: '{}' },
        { type: 'tool-call', id: second, name: 'lookup', arguments: '{}' },
      ],
    })
    // Two results share one message, which the single-result constructor cannot
    // express; the cast keeps the sibling block the router must not drop.
    const result = createUserMessage({
      source: { kind: 'tool', callId: first },
      content: [
        { type: 'tool-result', toolCallId: first, isError: false, content: [{ type: 'text', text: 'one' }] },
        { type: 'tool-result', toolCallId: second, isError: false, content: [{ type: 'text', text: 'two' }] },
      ],
    }) as UserMessage
    const messages = [user('old'), assistant, result, user('current')]
    const retained = selectContextMessages(messages, { scope: 'full', reason: 'test' })
    expect(retained.messages).toEqual(messages)
    const trimmed = selectContextMessages(messages, { scope: 'recent', reason: 'test' }, { recentMessages: 2 })
    expect(trimmed.messages).toEqual([messages[3]])
  })

  it('keeps the open turn working set when routing a later model step', () => {
    const id = ToolCallId('open-turn-call')
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id, name: 'lookup', arguments: '{}' }],
    })
    const result = createToolResultMessage({ callId: id, isError: false, content: [{ type: 'text', text: 'found' }] })
    const messages = [
      createSystemMessage('system', 'test'),
      user('旧 turn 的问题'),
      user('请继续当前任务'),
      assistant,
      result,
    ]
    const routed = selectContextMessages(
      messages,
      { scope: 'fresh', reason: 'step-local regression fixture' },
      { recentMessages: 1 },
      2,
    )
    expect(routed.messages).toEqual([messages[0], messages[2], messages[3], messages[4]])
    expect(routed.droppedMessages).toBe(1)
  })

  it('does not backfill older turns when an active tool unit cannot fit', () => {
    const id = ToolCallId('priority-call')
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id, name: 'lookup', arguments: '{}' }],
    })
    const result = createToolResultMessage({
      callId: id,
      isError: false,
      content: [{ type: 'text', text: 'x'.repeat(600) }],
    })
    const messages = [user('旧历史'), user('当前任务'), assistant, result]
    const routed = selectContextMessages(
      messages,
      { scope: 'task', reason: 'active turn priority' },
      { taskMessages: 20, maxTokens: 32 },
      1,
    )
    expect(routed.messages).toEqual([messages[1]])
    expect(routed.messages).not.toContain(messages[0])
  })

  it('applies the token budget to optional task history', () => {
    const messages = [user('context router'), ...Array.from({ length: 10 }, (_, i) => user(`历史 ${i} ${'x'.repeat(120)}`)), user('继续 context router')]
    const result = selectContextMessages(messages, { scope: 'task', reason: 'test' }, { taskMessages: 20, maxTokens: 40 })
    expect(result.messages.at(-1)).toBe(messages.at(-1))
    expect(result.estimatedInputTokens).toBeGreaterThan(0)
    expect(result.messages.length).toBeLessThan(messages.length)
    expect(result.budgetExceeded).toBe(false)
    expect(result.overflowTokens).toBe(0)
  })

  it('audits when required messages exceed the effective budget', () => {
    const system = createSystemMessage('system', 'system prompt that is intentionally larger than the request budget')
    const current = user('current request')
    const result = selectContextMessages([system, current], { scope: 'recent', reason: 'test' }, { maxTokens: 1 })
    expect(result.messages).toEqual([system, current])
    expect(result.budgetExceeded).toBe(true)
    expect(result.overflowTokens).toBe(result.estimatedInputTokens - 1)
  })

  it('bounds final message metadata for very large full-history snapshots', () => {
    const messages = Array.from({ length: 140 }, (_, index) => user(`history ${String(index)}`))
    const result = selectContextMessages(messages, { scope: 'full', reason: 'test' })
    expect(result.selectedMessageMeta).toHaveLength(128)
    expect(result.selectedMessageMetaOmitted).toBe(12)
    expect(result.selectedMessageMeta.at(0)?.preview).toBe('history 0')
    expect(result.selectedMessageMeta.at(-1)?.preview).toBe('history 139')
  })

  it('compacts older plain-text tool results without mutating the source messages', () => {
    const oldCall = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: ToolCallId('old-call'), name: 'lookup', arguments: '{}' }],
    })
    const oldResult = createToolResultMessage({
      callId: ToolCallId('old-call'), isError: false, content: [{ type: 'text', text: 'old result '.repeat(100) }],
    })
    const newCall = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: ToolCallId('new-call'), name: 'lookup', arguments: '{}' }],
    })
    const newResult = createToolResultMessage({
      callId: ToolCallId('new-call'), isError: false, content: [{ type: 'text', text: 'new result '.repeat(100) }],
    })
    const current = user('继续处理')
    const result = selectContextMessages(
      [oldCall, oldResult, newCall, newResult, current],
      { scope: 'full', reason: 'tool audit' },
      { toolResultMaxChars: 100, toolResultRecentMessages: 1 },
    )
    const oldText = messageText(result.messages[1]!)
    const newText = messageText(result.messages[3]!)
    expect(oldText).toContain('旧工具结果已压缩')
    expect(oldText.length).toBeLessThanOrEqual(100)
    expect(newText).toContain('new result')
    expect(newText.length).toBeGreaterThan(100)
    expect(messageText(oldResult)).toContain('old result '.repeat(2))
    expect(result.toolAudit).toMatchObject({
      toolCallMessages: 2,
      toolResultMessages: 2,
      compactedToolResults: 1,
      deduplicatedToolResults: 0,
    })
    expect(result.messages.map(message => message.id)).toEqual([oldCall.id, oldResult.id, newCall.id, newResult.id, current.id])
  })

  it('deduplicates older repeated tool results while preserving call-result pairs', () => {
    const makeRound = (callId: string) => [
      createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'tool-call', id: ToolCallId(callId), name: 'lookup', arguments: '{}' }],
      }),
      createToolResultMessage({
        callId: ToolCallId(callId), isError: false, content: [{ type: 'text', text: 'same result' }],
      }),
    ]
    const [firstCall, firstResult, secondCall, secondResult] = [...makeRound('first'), ...makeRound('second')]
    const result = selectContextMessages(
      [firstCall!, firstResult!, secondCall!, secondResult!, user('继续')],
      { scope: 'full', reason: 'tool dedupe' },
      { toolResultRecentMessages: 1 },
    )
    expect(messageText(result.messages[1]!)).toBe('[重复工具结果已省略；请使用首次结果]')
    expect(messageText(result.messages[3]!)).toBe('same result')
    expect(result.toolAudit?.deduplicatedToolResults).toBe(1)
    expect(result.messages).toHaveLength(5)
  })

  it('compacts each tool-result block independently', () => {
    const first = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [
        { type: 'tool-call', id: ToolCallId('multi-a'), name: 'lookup', arguments: '{}' },
        { type: 'tool-call', id: ToolCallId('multi-b'), name: 'lookup', arguments: '{}' },
      ],
    })
    const result = createToolResultMessage({
      callId: ToolCallId('multi-a'), isError: false, content: [{ type: 'text', text: 'a'.repeat(120) }],
    })
    const second = createToolResultMessage({
      callId: ToolCallId('multi-b'), isError: false, content: [{ type: 'text', text: 'b'.repeat(120) }],
    })
    const combined = { ...result, content: [...result.content, ...second.content] }
    const selected = selectContextMessages([first, combined, user('keep')], { scope: 'full', reason: 'multi-block' }, {
      toolResultMaxChars: 80,
      toolResultRecentMessages: 0,
    })
    const blocks = selected.messages[1]?.content
    expect(blocks).toHaveLength(2)
    expect(blocks?.[0]).toMatchObject({ toolCallId: ToolCallId('multi-a'), content: [{ type: 'text', text: expect.stringContaining('旧工具结果已压缩') }] })
    expect(blocks?.[1]).toMatchObject({ toolCallId: ToolCallId('multi-b'), content: [{ type: 'text', text: expect.stringContaining('旧工具结果已压缩') }] })
  })

  it('normalizes non-finite selector options instead of leaking NaN or Infinity', () => {
    const result = selectContextMessages([user('request')], { scope: 'recent', reason: 'options' }, {
      recentMessages: Number.NaN,
      maxTokens: Number.POSITIVE_INFINITY,
      pluginContextRatio: Number.NaN,
    })
    expect(result.estimatedInputTokens).toBeGreaterThan(0)
    expect(result.budgetExceeded).toBe(false)
  })
})
