import { describe, expect, it, vi } from 'vitest'
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
    ctx.provide('personalAgent', { contextBudget: () => 32_000 } as never)
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
      maxInputTokens: 32_000,
      selectedMessageIds: [String(system.id), String(current.id)],
    })
  })

  it('audits full request-window occupancy including output reservation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-window-accounting'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const current = user('当前请求需要完整预算审计')
    ctx.provide('personalAgent', { contextBudget: () => 32_000 } as never)
    applyContextRouter(ctx)
    session.append('turn/start', { turn: 1 })
    session.append('request/header', {
      header: {
        config: { provider: 'test', model: 'test', maxTokens: 16 },
        tools: [{ name: 'lookup', description: 'look up', parameters: { type: 'object' } }],
      },
      reason: 'initial',
    })
    session.append('request/context', { provider: 'test', model: 'test', contextWindow: 32 })

    await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [current], signal: new AbortController().signal,
    }, () => Promise.resolve([current]))

    const audit = session.snapshotEvents().find(event => event.type === 'context/router')
    if (audit === undefined || audit.type !== 'context/router') throw new Error('context/router audit missing')
    expect(audit.data.estimatedWindowTokens).toBe(
      audit.data.estimatedRequestTokens! + audit.data.outputBudgetTokens!,
    )
    expect(audit.data.requestOverflowTokens).toBeGreaterThan(0)
    expect(audit.data.budgetExceeded).toBe(true)
  })

  it('learns a bounded provider safety reserve from reported prompt usage', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-calibration'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const first = user('校准上下文估算')
    const second = user('继续校准上下文估算')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/context', { provider: 'test', model: 'calibrated', contextWindow: 4_096 })
    session.append('request/header', {
      header: { config: { provider: 'test', model: 'calibrated', maxTokens: 16 } },
      reason: 'initial',
    })
    session.append('user/message', first, { surfaceOp: 'append' })
    applyContextRouter(ctx)
    await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [first], signal: new AbortController().signal,
    }, () => Promise.resolve([first]))
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({ source: { provider: 'test', model: 'calibrated' }, content: [{ type: 'text', text: 'ok' }] }),
      usage: { inputTokens: 1_000, outputTokens: 1 },
      stream: [],
    }, { surfaceOp: 'append' })
    await Promise.resolve()

    session.append('turn/start', { turn: 2 })
    session.append('user/message', second, { surfaceOp: 'append' })
    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 2, step: 1, messages: [second], signal: new AbortController().signal,
    }, () => Promise.resolve([second]))

    expect(routed).toEqual([second])
    const audits = session.snapshotEvents().filter(event => event.type === 'context/router')
    expect(audits.at(-1)?.type).toBe('context/router')
    expect(audits.at(-1)?.data.safetyReserveTokens).toBeGreaterThan(256)
    expect(audits.at(-1)?.data.calibrationSampleCount).toBe(1)
    expect(session.snapshotEvents().some(event => event.type === 'context/calibration')).toBe(true)
  })

  it('audits downstream-normalized messages as the final payload', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-final-payload'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const callId = ToolCallId('final-payload-call')
    const current = user('完整回顾当前任务')
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }],
    })
    const toolResult = createToolResultMessage({
      callId,
      isError: false,
      content: [{ type: 'text', text: '原始工具结果' }],
    })
    const normalized = '规范化后的工具结果'
    ctx.on('agent/request-context', async ({ messages }, next) => {
      const downstream = await next()
      return downstream.map(message => message.source.kind === 'tool'
        ? {
          ...message,
          content: [{
            type: 'tool-result', toolCallId: callId, isError: false,
            content: [{ type: 'text', text: normalized }],
          }],
        }
        : message)
    })
    applyContextRouter(ctx)
    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [current, assistant, toolResult], signal: new AbortController().signal,
    }, () => Promise.resolve([current, assistant, toolResult]))

    expect(JSON.stringify(routed)).toContain(normalized)
    const audit = session.snapshotEvents().find(event => event.type === 'context/router')
    expect(audit?.data.selectedMessageMeta?.find(item => item.id === String(toolResult.id))?.preview).toContain(normalized)
  })

  it('audits provider-neutral file or image projection at the adapter boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-adapter-projection'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const current = user('当前请求')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx)
    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [current], signal: new AbortController().signal,
    }, () => Promise.resolve([current]))
    const projected = {
      ...routed[0]!,
      content: [{ type: 'text', text: 'provider-visible projected content' }],
    }
    ctx.emit('llm/request-ready', {
      provider: 'test', model: 'test', messages: [projected], sessionId: session.id,
    }, { files: true, images: false })

    const audits = session.snapshotEvents().filter(event => event.type === 'context/router')
    const finalAudit = audits.at(-1)
    expect(finalAudit?.type).toBe('context/router')
    expect(finalAudit?.data.finalPayload).toBe(true)
    expect(finalAudit?.data.adapterProjection).toEqual({ files: true, images: false })
    expect(finalAudit?.data.selectedMessageMeta?.[0]?.preview).toContain('provider-visible projected content')
  })

  it('does not associate auxiliary model calls with an ordinary context audit', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-auxiliary-call'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const current = user('当前请求')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx)
    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [current], signal: new AbortController().signal,
    }, () => Promise.resolve([current]))

    ctx.emit('llm/request-ready', {
      provider: 'test', model: 'test', messages: routed, sessionId: session.id, purpose: 'compaction',
    }, { files: true, images: false })

    const audits = session.snapshotEvents().filter(event => event.type === 'context/router')
    expect(audits).toHaveLength(1)
    expect(audits[0]?.type === 'context/router' && audits[0].data.finalPayload).toBeFalsy()
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

  it('records the open-turn signal separately from the task scope', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-open-turn-signal'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const current = user('执行当前任务')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx)

    await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 2, messages: [current], signal: new AbortController().signal,
    }, () => Promise.resolve([current]))

    const audit = session.snapshotEvents().find(event => event.type === 'context/router')
    expect(audit?.type).toBe('context/router')
    expect(audit?.data).toMatchObject({ scope: 'task', signal: 'open-turn' })
  })

  it('recovers the open-turn start from durable events after router restart', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-restart-recovery'))
    const old = user('旧历史，不应在当前工具链无法放入时回填')
    const current = user('当前任务')
    const callId = ToolCallId('restart-recovery-call')
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }],
    })
    const result = createToolResultMessage({
      callId,
      isError: false,
      content: [{ type: 'text', text: 'x'.repeat(600) }],
    })
    // Append the turn before installing the router. Its in-memory WeakMap is
    // therefore empty when the step-2 request simulates a resumed process.
    session.append('turn/start', { turn: 1 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx, { maxTokens: 32 })
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 2, messages: [old, current, assistant, result], signal: new AbortController().signal,
    }, () => Promise.resolve([old, current, assistant, result]))

    expect(routed).toEqual([current])
  })

  it('recalls the latest durable task for a short continuation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-task-recall'))
    const old = user('上一轮任务：实现飞书消息渲染')
    const current = user('好的')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', old, { surfaceOp: 'append' })
    session.append('task/created' as never, {
      id: 'task-1', goal: '实现飞书消息渲染', status: 'created', owner: 'test', turn: 1,
      budget: { maxSteps: 2 }, createdAt: 1, updatedAt: 1,
    } as never, { ignorable: true } as never)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx, { recentMessages: 1, taskMessages: 1 })
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 2, step: 1, messages: [old, current], signal: new AbortController().signal,
    }, () => Promise.resolve([old, current]))

    expect(routed).toEqual([old, current])
    const audit = session.snapshotEvents().find(event => event.type === 'context/router')
    expect(audit?.data).toMatchObject({ taskId: 'task-1', taskRecallMessages: 1 })
  })

  it('bounds durable task messages in the real request waterfall', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-bounded-task-recall'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const prior = Array.from({ length: 12 }, (_, index) => user(`任务阶段 ${String(index)}`))
    const current = user('好的')
    session.append('turn/start', { turn: 1 })
    for (const message of prior) session.append('user/message', message, { surfaceOp: 'append' })
    session.append('task/created' as never, {
      id: 'task-bounded', goal: '持续任务', status: 'created', owner: 'test', turn: 1,
      budget: { maxSteps: 2 }, createdAt: 1, updatedAt: 1,
    } as never, { ignorable: true } as never)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx, { recentMessages: 1, taskMessages: 3 })

    const routed = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 2, step: 1, messages: [...prior, current], signal: new AbortController().signal,
    }, () => Promise.resolve([...prior, current]))

    expect(routed).toEqual([...prior.slice(-3), current])
    const audit = session.snapshotEvents().find(event => event.type === 'context/router')
    expect(audit?.data).toMatchObject({ taskId: 'task-bounded', taskRecallMessages: 3 })
  })

  it('folds only newly appended durable events on repeated recalls', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('context-router-incremental-index'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    const old = user('上一轮任务：持续优化上下文路由')
    const current = user('继续上下文路由任务')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', old, { surfaceOp: 'append' })
    session.append('task/created' as never, {
      id: 'task-1', goal: '持续优化上下文路由', status: 'created', owner: 'test', turn: 1,
      budget: { maxSteps: 2 }, createdAt: 1, updatedAt: 1,
    } as never, { ignorable: true } as never)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', current, { surfaceOp: 'append' })
    applyContextRouter(ctx, { recentMessages: 1, taskMessages: 1 })

    const snapshot = vi.spyOn(session, 'snapshotEvents')
    const request = () => agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 2, step: 1, messages: [old, current], signal: new AbortController().signal,
    }, () => Promise.resolve([old, current]))
    const firstRequestEnd = Number(session.seq)
    await request()
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await request()

    const ranges = snapshot.mock.calls.filter(call => call.length === 2)
    expect(ranges.at(0)?.[0]).toBe(0)
    expect(ranges.at(-1)?.[0]).toBe(firstRequestEnd)
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
