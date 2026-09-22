import { describe, expect, it } from 'vitest'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { contextCapacity, resolveContextBudget, resolveContextRoute, resolveContextRouteForMessages, selectContextMessages } from '../src/router.ts'

const user = (text: string): Message => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
describe('context router', () => {
  it('reserves output and tool schemas inside the provider context window', () => {
    expect(resolveContextBudget({ maxTokens: 24_000 }, {
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

  it('classifies explicit routing language', () => {
    expect(resolveContextRoute('今天天气怎么样？').scope).toBe('recent')
    expect(resolveContextRoute('继续刚才的旧任务').scope).toBe('task')
    expect(resolveContextRoute('换个话题，问个无关的问题').scope).toBe('fresh')
    expect(resolveContextRoute('请完整回顾全部历史').scope).toBe('full')
  })

  it('treats an unrelated unqualified request as fresh', () => {
    const messages = [user('继续实现 context router'), user('继续修复测试')]
    expect(resolveContextRouteForMessages('今天天气怎么样？', messages, 4).scope).toBe('fresh')
    expect(resolveContextRouteForMessages('context router 测试失败了', messages, 4).scope).toBe('recent')
  })

  it('drops old ordinary history for a fresh question but keeps system and current user', () => {
    const messages = [createSystemMessage('system', 'test'), user('旧问题'), user('今天天气怎么样？')]
    const result = selectContextMessages(messages, resolveContextRoute('换个话题').scope === 'fresh'
      ? resolveContextRoute('换个话题')
      : { scope: 'fresh', reason: 'test' })
    expect(result.messages).toEqual([messages[0], messages[2]])
  })

  it('retains matching task history beyond the recent tail', () => {
    const messages = [user('实现 context router 的接口'), ...Array.from({ length: 5 }, (_, i) => user(`无关轮次 ${i}`)), user('继续 context router 任务')]
    const result = selectContextMessages(messages, { scope: 'task', reason: 'test' }, { taskMessages: 2 })
    expect(result.messages).toContain(messages[0])
    expect(result.messages.at(-1)).toBe(messages.at(-1))
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

  it('applies the token budget to optional task history', () => {
    const messages = [user('context router'), ...Array.from({ length: 10 }, (_, i) => user(`历史 ${i} ${'x'.repeat(120)}`)), user('继续 context router')]
    const result = selectContextMessages(messages, { scope: 'task', reason: 'test' }, { taskMessages: 20, maxTokens: 40 })
    expect(result.messages.at(-1)).toBe(messages.at(-1))
    expect(result.estimatedInputTokens).toBeGreaterThan(0)
    expect(result.messages.length).toBeLessThan(messages.length)
  })
})
