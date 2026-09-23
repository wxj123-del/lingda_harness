import { describe, expect, it } from 'vitest'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import { estimateMessage, estimateToolsTokens } from '@deepseek-ai/dsh-token-meter'
import { contextCapacity, resolveContextBudget, resolveContextRoute, resolveContextRouteForMessages, selectContextMessages } from '../src/router.ts'

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
      requestHeader: () => ({ config: { maxTokens: 2_048 }, tools: [{ name: 'lookup' }] }),
    })
    expect(capacity.contextWindow).toBe(8_192)
    expect(capacity.outputBudgetTokens).toBe(2_048)
    expect(capacity.toolSchemaTokens).toBeGreaterThan(0)
  })

  it('uses the token-meter estimator for routed messages and tool schemas', () => {
    const messages = [createSystemMessage('system', 'system prompt'), user('current request')]
    const selection = selectContextMessages(messages, { scope: 'full', reason: 'test' })
    expect(selection.estimatedInputTokens).toBe(messages.reduce((total, message) => total + estimateMessage(message), 0))
    const header = { config: {}, tools: [{ name: 'lookup' }] }
    expect(contextCapacity({
      requestContext: () => ({ provider: 'test', model: 'test', contextWindow: 8_192 }),
      requestHeader: () => header,
    }).toolSchemaTokens).toBe(estimateToolsTokens(header))
  })

  it('classifies explicit routing language', () => {
    expect(resolveContextRoute('今天天气怎么样？')).toMatchObject({ scope: 'recent', signal: 'unrelated' })
    expect(resolveContextRoute('继续刚才的旧任务')).toMatchObject({ scope: 'task', signal: 'task-reference' })
    expect(resolveContextRoute('换个话题，问个无关的问题')).toMatchObject({ scope: 'fresh', signal: 'explicit-fresh' })
    expect(resolveContextRoute('请完整回顾全部历史')).toMatchObject({ scope: 'full', signal: 'explicit-full' })
  })

  it('treats an unrelated unqualified request as fresh', () => {
    const messages = [user('继续实现 context router'), user('继续修复测试')]
    expect(resolveContextRouteForMessages('今天天气怎么样？', messages, 4)).toMatchObject({ scope: 'fresh', signal: 'unrelated' })
    expect(resolveContextRouteForMessages('context router 测试失败了', messages, 4)).toMatchObject({ scope: 'recent', signal: 'lexical-match' })
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
    const result = createUserMessage({
      source: { kind: 'tool' },
      content: [
        { type: 'tool-result', toolCallId: first, isError: false, content: [{ type: 'text', text: 'one' }] },
        { type: 'tool-result', toolCallId: second, isError: false, content: [{ type: 'text', text: 'two' }] },
      ],
    })
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
})
