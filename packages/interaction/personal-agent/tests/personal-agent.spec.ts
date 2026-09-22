import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import PersonalAgentService, { suggestMode, type Config as PersonalAgentConfig } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private doc: Record<string, unknown> = {}

  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.doc)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

async function harness(withSettings = false, personalConfig?: PersonalAgentConfig): Promise<{ ctx: Context; session: Session; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withSettings) await ctx.plugin(MemorySettings)
  await ctx.plugin(PersonalAgentService, personalConfig)
  const session = ctx.sessions.create(SessionId(`personal-${Math.random().toString(36).slice(2)}`))
  const agent = { id: session.id, session, ctx } as unknown as Agent
  return { ctx, session, agent }
}

describe('personal agent modes', () => {
  it('suggests a mode locally without an LLM call', () => {
    expect(suggestMode('修改这个 TypeScript 文件')).toBe('coding')
    expect(suggestMode('调研这个主题并附来源')).toBe('research')
    expect(suggestMode('生成一张图片')).toBe('execution')
    expect(suggestMode('你好，解释一下这个概念')).toBeUndefined()
  })

  it('pins a durable default mode and switches it through the session log', async () => {
    const { ctx, session, agent } = await harness()
    expect(session.snapshotEvents().some(event => event.type === 'agent/mode')).toBe(true)
    expect(ctx.personalAgent.current(agent)).toBe('qa')
    ctx.personalAgent.set(agent, 'coding')
    expect(ctx.personalAgent.current(agent)).toBe('coding')
    expect(session.snapshotEvents().filter(event => event.type === 'agent/mode').at(-1)?.data).toEqual({ mode: 'coding' })
  })

  it('reads the default mode from user settings for new sessions', async () => {
    const { ctx } = await harness(true)
    await ctx.settings.update('personal-agent', { defaultMode: 'research' })
    const session = ctx.sessions.create(SessionId(`settings-${Math.random().toString(36).slice(2)}`))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    expect(ctx.personalAgent.current(agent)).toBe('research')
  })

  it('filters model-visible tools and rejects hidden calls at execution time', async () => {
    const { ctx, agent } = await harness()
    ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read', parameters: {}, execute: async () => [] }))
    ctx.tools.register(defineContentToolFixture({ name: 'bash', description: 'bash', parameters: {}, execute: async () => [] }))
    ctx.systemPrompt.section({ name: 'tool:read', order: 100, text: 'read guidance' })
    ctx.systemPrompt.section({ name: 'tool:bash', order: 100, text: 'bash guidance' })
    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(agent))
    expect(assembly.tools.map(tool => tool.name)).not.toContain('read')
    const denied = await ctx.tools.execute({ name: 'bash', callId: 'mode-denied' as never, arguments: {}, agent, signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('不在当前问答模式的允许范围内')
  })

  it('records why mode-filtered tools were omitted from the request context', async () => {
    const { ctx, session, agent } = await harness()
    ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read', parameters: {}, execute: async () => [] }))
    ctx.tools.register(defineContentToolFixture({ name: 'bash', description: 'bash', parameters: {}, execute: async () => [] }))
    ctx.systemPrompt.section({ name: 'tool:read', order: 100, text: 'read guidance' })
    ctx.systemPrompt.section({ name: 'tool:bash', order: 100, text: 'bash guidance' })
    session.append('turn/start', { turn: 1 })
    await ctx.systemPrompt.assemble(assembleContextFor(agent))
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '解释一下' }] })
    await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [message], signal: new AbortController().signal,
    }, () => Promise.resolve([message]))
    const audit = sessionEvents(agent.session).at(-1)?.data as { hiddenTools?: { name: string }[] }
    expect(audit.hiddenTools?.map(item => item.name)).toEqual(expect.arrayContaining(['read', 'bash']))
  })

  it('captures a bounded request audit and keeps the active mode stable for the turn', async () => {
    const { ctx, session, agent } = await harness()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    ctx.personalAgent.set(agent, 'coding')
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '当前请求' }] })
    const result = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [message], signal: new AbortController().signal,
    }, () => Promise.resolve([message]))
    expect(result).toEqual([message])
    expect(session.snapshotEvents().find(event => event.type === 'agent/request-context')?.data).toMatchObject({
      turn: 1, step: 1, mode: 'qa', maxSteps: 0, inputMessages: 1, outputMessages: 1,
    })
    expect(ctx.personalAgent.current(agent)).toBe('coding')
  })

  it('does not emit personal context audits for unmanaged preset sessions', async () => {
    const { ctx, session, agent } = await harness()
    const presets = { composedPreset: () => 'legacy' }
    ctx.provide('agentPresets', presets as never)
    session.append('turn/start', { turn: 1 })
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '保留旧 preset 行为' }] })
    const result = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [message], signal: new AbortController().signal,
    }, () => Promise.resolve([message]))
    expect(result).toEqual([message])
    expect(sessionEvents(session)).toHaveLength(0)
  })

  it('inherits a selected personal mode into a child session', async () => {
    const { ctx, session, agent } = await harness()
    ctx.provide('agentPresets', { composedPreset: () => 'legacy' } as never)
    ctx.personalAgent.set(agent, 'coding')
    const childSession = ctx.sessions.create(SessionId(`child-${Math.random().toString(36).slice(2)}`), {
      meta: { parentSession: session.id, agentPreset: 'legacy' },
    })
    const child = { id: childSession.id, session: childSession, ctx } as unknown as Agent
    await agentEvents(ctx, child).serial('agent/created', { source: 'startup' })
    expect(ctx.personalAgent.current(child)).toBe('coding')
    expect(childSession.snapshotEvents().find(event => event.type === 'agent/mode')?.data).toEqual({ mode: 'coding' })
  })

  it('keeps the current user request when retrieval or history follows it', async () => {
    const { ctx, agent } = await harness(false, { modes: { qa: { maxContextTokens: 20 } } })
    const old = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '旧历史内容' }] })
    const current = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '当前用户请求必须保留' }] })
    const retrieval = createUserMessage({ source: { kind: 'plugin', plugin: 'knowledge-auto-retrieval' }, content: [{ type: 'text', text: '检索结果应该被裁剪' }] })
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', old, { surfaceOp: 'append' })
    agent.session.append('user/message', current, { surfaceOp: 'append' })
    agent.session.append('user/message', retrieval, { surfaceOp: 'append' })
    const result = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [old, current, retrieval], signal: new AbortController().signal,
    }, () => Promise.resolve([old, current, retrieval]))
    expect(result).toContain(current)
    expect(result).not.toContain(old)
    expect(sessionEvents(agent.session).at(-1)?.data).toMatchObject({
      outputMessages: 1,
      droppedMessages: 2,
    })
  })

  it('leaves history selection and token bounds to the global context router when mounted', async () => {
    const { ctx, session, agent } = await harness(false, { modes: { qa: { historyTurns: 1, maxContextTokens: 20 } } })
    ctx.provide('contextRouter', { active: true })
    const old = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '很早以前的历史内容'.repeat(20) }] })
    const current = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '当前请求' }] })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', old, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', current, { surfaceOp: 'append' })

    const result = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 2, step: 1, messages: [old, current], signal: new AbortController().signal,
    }, () => Promise.resolve([old, current]))

    expect(result).toEqual([old, current])
    expect(sessionEvents(session).at(-1)?.data).toMatchObject({ outputMessages: 2, droppedMessages: 0 })
  })

  it('drops a tool call and its result together when the pair exceeds the context budget', async () => {
    const { ctx, session, agent } = await harness(false, { modes: { qa: { maxContextTokens: 60 } } })
    const callId = ToolCallId('call-orphan-prevention')
    const current = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '当前请求' }] })
    const assistant = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: callId, name: 'lookup', arguments: JSON.stringify({ query: 'a'.repeat(500) }) }],
    })
    const result = createToolResultMessage({
      callId,
      isError: false,
      content: [{ type: 'text', text: '一个很大的工具结果，不能和调用拆开保留'.repeat(4) }],
    })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', current, { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: assistant, stream: [], usage: { inputTokens: 0, outputTokens: 0 } }, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' })
    const retained = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 2, messages: [current, assistant, result], signal: new AbortController().signal,
    }, () => Promise.resolve([current, assistant, result]))
    expect(retained).toEqual([current])
    expect(sessionEvents(session).at(-1)?.data).toMatchObject({ outputMessages: 1, droppedMessages: 2 })
  })

  it('clips every tool-result block without dropping sibling results', async () => {
    const { ctx, session, agent } = await harness(false, { modes: { qa: { maxToolResultBytes: 120 } } })
    const first = ToolCallId('multi-clip-first')
    const second = ToolCallId('multi-clip-second')
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
        { type: 'tool-result', toolCallId: first, isError: false, content: [{ type: 'text', text: 'a'.repeat(500) }] },
        { type: 'tool-result', toolCallId: second, isError: false, content: [{ type: 'text', text: 'b'.repeat(500) }] },
      ],
    })
    const current = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '当前请求' }] })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', current, { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: assistant, stream: [], usage: { inputTokens: 0, outputTokens: 0 } }, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' })
    const retained = await agentEvents(ctx, agent).waterfall('agent/request-context', {
      turn: 1, step: 1, messages: [assistant, result, current], signal: new AbortController().signal,
    }, () => Promise.resolve([assistant, result, current]))

    const output = retained.find(message => message.role === 'user' && message.source.kind === 'tool')
    expect(output?.content).toHaveLength(2)
    expect(output?.content.every(block => block.type === 'tool-result' && block.content[0]?.type === 'text')).toBe(true)
    expect(output?.content.every(block => block.type === 'tool-result' && block.content[0]?.type === 'text' && block.content[0].text.includes('工具结果已裁剪'))).toBe(true)
  })

  it('projects a durable task lifecycle on top of turn events', async () => {
    const { ctx, session } = await harness()
    session.append('turn/start', { turn: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.sessionProjections.stateOf(session, 'personalAgentTask')?.current).toMatchObject({
      id: `${String(session.id)}:1`, status: 'created', turn: 1,
    })
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '实现任务状态投影' }] }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    const events = session.snapshotEvents()
    expect(events.filter(event => event.type.startsWith('task/')).map(event => event.type)).toEqual([
      'task/created', 'task/planned', 'task/running', 'task/succeeded',
    ])
    expect(ctx.sessionProjections.stateOf(session, 'personalAgentTask')?.current).toMatchObject({
      goal: '实现任务状态投影', status: 'succeeded',
    })
  })

  it('charges one tool round per model step instead of one per parallel call', async () => {
    const { ctx, session, agent } = await harness(false, { modes: { coding: { maxSteps: 2 } } })
    ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'read', parameters: {}, execute: async () => [] }))
    // The mode is pinned for the whole turn when the turn opens.
    ctx.personalAgent.set(agent, 'coding')
    session.append('turn/start', { turn: 1 })
    const call = async (step: number, callId: string): Promise<boolean> => {
      // The Agent loop appends the durable call event before pre-execute.
      session.append('tool/call', { turn: 1, step, callId: callId as never, name: 'read', arguments: '{}' })
      const result = await ctx.tools.execute({
        name: 'read', callId: callId as never, arguments: {}, agent, signal: new AbortController().signal,
      })
      return result.isError === true
    }
    session.append('step/start', { turn: 1, step: 1 })
    // A batched step is one round, so four parallel calls stay inside the cap.
    expect(await Promise.all(['a', 'b', 'c', 'd'].map(id => call(1, id)))).toEqual([false, false, false, false])
    session.append('step/end', { turn: 1, step: 1 })
    session.append('step/start', { turn: 1, step: 2 })
    expect(await call(2, 'e')).toBe(false)
    session.append('step/end', { turn: 1, step: 2 })
    session.append('step/start', { turn: 1, step: 3 })
    expect(await call(3, 'f')).toBe(true)
  })
})

function sessionEvents(session: Session) {
  return session.snapshotEvents().filter(event => event.type === 'agent/request-context')
}
