import { describe, expect, it } from 'vitest'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { selectContextMessages } from '../src/router.ts'

const user = (text: string): Message => createUserMessage({
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

describe('context router integration', () => {
  it('keeps a multi-step tool working set instead of routing each step as fresh', () => {
    const id = ToolCallId('context-router-call')
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id, name: 'lookup', arguments: '{}' }],
    })
    const result = createToolResultMessage({ callId: id, isError: false, content: [{ type: 'text', text: 'found' }] })
    const first = [createSystemMessage('system', 'test'), user('旧 turn'), user('执行当前任务')]
    const firstRouted = selectContextMessages(first, { scope: 'fresh', reason: 'turn boundary' }, { recentMessages: 1 }).messages
    const second = [...first, assistant, result]
    const secondRouted = selectContextMessages(second, { scope: 'task', reason: 'open turn' }, { recentMessages: 1 }, 2).messages
    const third = [...second, user('当前 turn 的补充要求')]
    const thirdRouted = selectContextMessages(third, { scope: 'task', reason: 'open turn' }, { recentMessages: 1 }, 2).messages

    expect(firstRouted).toEqual([first[0], first[2]])
    expect(secondRouted).toEqual(second)
    expect(thirdRouted).toEqual(third)
  })

  it('does not collapse a long open tool chain to the system prompt and user message', () => {
    let messages: Message[] = [createSystemMessage('system', 'test'), user('执行长任务')]
    for (let step = 1; step <= 68; step += 1) {
      const id = ToolCallId(`long-chain-${String(step)}`)
      messages = [
        ...messages,
        createAssistantMessage({
          source: { provider: 'test', model: 'test' },
          content: [{ type: 'tool-call', id, name: 'lookup', arguments: JSON.stringify({ step }) }],
        }),
        createToolResultMessage({ callId: id, isError: false, content: [{ type: 'text', text: `result ${String(step)}` }] }),
      ]
      const routed = selectContextMessages(messages, { scope: 'task', reason: 'open turn' }, {}, 1)
      expect(routed.messages.length).toBe(messages.length)
      expect(routed.messages.length).toBeGreaterThan(3)
    }
  })
})
