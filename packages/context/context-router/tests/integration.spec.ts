import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { apply as applyContextRouter } from '../src/index.ts'
import { selectContextMessages } from '../src/router.ts'

const user = (text: string): Message => createUserMessage({
  source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

describe('context router integration', () => {
  it('audits the final snapshot after an inner context listener transforms it', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-order'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const system = createSystemMessage('system', 'test')
    const old = user('旧历史')
    const current = user('当前请求')
    const transformed: Message[] = [system, current]
    let innerInput: readonly Message[] | undefined
    ctx.on('agent/request-context', async ({ messages }, next) => {
      innerInput = messages
      await next()
      return transformed
    })
    applyContextRouter(ctx)
    session.append('turn/start', { turn: 1 })
    session.append('user/message', old, { surfaceOp: 'append' })
    session.append('user/message', current, { surfaceOp: 'append' })

    const result = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [system, old, current], signal: new AbortController().signal,
    }, () => Promise.resolve([system, old, current]))

    expect(innerInput).toEqual([system, old, current])
    expect(result).toEqual(transformed)
    const audit = session.snapshotEvents().find(event => event.type === 'context/router')
    expect(audit?.data).toMatchObject({
      inputMessages: 2,
      outputMessages: 2,
      selectedMessageIds: [String(system.id), String(current.id)],
    })
  })

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
