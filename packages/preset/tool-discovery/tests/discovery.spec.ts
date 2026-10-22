import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as Discovery from '../src/index.ts'

class Query extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('Unused search backend') }
  async searchEvents(): Promise<never> { throw new Error('Unused search backend') }
}

const config: Discovery.Config = {
  initialTools: 3, maxTools: 5, pinnedTools: ['read'], fallbackTools: ['bash', 'edit'],
  historySessions: 50, searchLimit: 2, descriptionChars: 80, resultMaxBytes: 1024,
}
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
})

async function harness(overrides: Partial<Discovery.Config> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(Query)
  const definitions = [
    ['read', 'Read files'], ['bash', 'Run commands'], ['edit', 'Edit files'], ['web_search', 'Search the web'],
    ['generate_image', 'Generate image'], ['list_image_models', 'List image models'], ['generate_speech', 'Generate speech'],
  ]
  for (const [name, description] of definitions) {
    ctx.tools.register(defineTool({ name: name!, description: description!, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() { return 'ok' },
    }))
    ctx.systemPrompt.section({ name: `tool:${name!}`, order: 100, text: `Guidance for ${name!}.` })
  }
  let fiber: Awaited<ReturnType<Context['plugin']>>
  const handle = await ctx.agents.create({
    sessionId: SessionId('current'),
    setup: async (agentCtx) => { fiber = await agentCtx.plugin(Discovery, Object.assign({}, config, overrides)) },
  })
  const assemble = () => ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
  const names = async () => (await assemble()).tools.map(tool => tool.name)
  return { ctx, agent: handle.agent, assemble, names, disposeDiscovery: () => fiber.dispose() }
}

function appendCall(session: Session, name: string, id: string) {
  return session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(id), name, arguments: '{}' })
}

async function search(ctx: Context, agent: Agent, query: string, commit = true) {
  const callId = ToolCallId(`search-${agent.session.seq}`)
  const call = agent.session.append('tool/call', { turn: 1, step: 1, callId, name: 'tool_search', arguments: JSON.stringify({ query }) })
  const result = await ctx.tools.execute({ callId, name: 'tool_search', arguments: { query }, agent, signal: new AbortController().signal })
  if (commit) agent.session.append('tool/result', {
    turn: 1, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return result
}

describe('bounded tool discovery', () => {
  it('starts with a small stable catalog and removes only matching tool guidance; disposal restores tools', async () => {
    const h = await harness()
    expect(await h.names()).toEqual(['bash', 'edit', 'read', 'tool_search'])
    expect((await h.assemble()).sections.map(section => section.name)).not.toContain('tool:generate_image')
    expect((await h.ctx.systemPrompt.assemble()).tools).toHaveLength(7)
    await h.disposeDiscovery()
    expect(await h.names()).toHaveLength(7)
    expect(h.ctx.tools.get('tool_search', h.agent)).toBeUndefined()
  })

  it('ranks by recorded calls, ignores mere exposure and reads history only once per agent', async () => {
    const h = await harness()
    const history = h.ctx.sessions.create(SessionId('history'))
    appendCall(history, 'web_search', 'old-1')
    appendCall(history, 'web_search', 'old-2')
    history.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' }, tools: [h.ctx.tools.schemas().find(tool => tool.name === 'generate_image')!] } })
    const reads = vi.spyOn(h.ctx.sessionQuery, 'observeSession')
    expect(await h.names()).toEqual(['bash', 'read', 'tool_search', 'web_search'])
    expect(reads).toHaveBeenCalledTimes(2)
    expect(await h.names()).toEqual(['bash', 'read', 'tool_search', 'web_search'])
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it('loads only relevant results after their successful durable commit and preserves their parameters', async () => {
    const h = await harness()
    await h.assemble()
    const uncommitted = await search(h.ctx, h.agent, 'generate_speech', false)
    expect(uncommitted.isError).toBe(false)
    expect(await h.names()).not.toContain('generate_speech')
    const result = await search(h.ctx, h.agent, 'image')
    expect(result.isError).toBe(false)
    expect(result.meta).toMatchObject({ toolDiscovery: ['generate_image', 'list_image_models'] })
    expect(result.meta).toMatchObject({
      toolDiscoveryReasons: expect.arrayContaining([{ name: 'generate_image', reason: 'lexical-match' }]),
    })
    expect(await h.names()).toEqual(['bash', 'edit', 'generate_image', 'list_image_models', 'read', 'tool_search'])
    expect((await h.assemble()).tools.find(tool => tool.name === 'generate_image'))
      .toEqual(h.ctx.tools.schemas(h.agent).find(tool => tool.name === 'generate_image'))
    expect(await h.names()).not.toContain('generate_speech')
    const standard = await h.ctx.agents.create({ sessionId: SessionId('standard') })
    expect((await h.ctx.systemPrompt.assemble(assembleContextFor(standard.agent))).tools).toHaveLength(7)
  })

  it('uses a typed decision endpoint for semantic capability matches', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      capability: {
        choice: 'generate_image',
        confidence: 0.91,
        probabilities: { generate_image: 0.91, list_image_models: 0.06, generate_speech: 0.03 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const h = await harness({
      decisionModel: { url: 'http://127.0.0.1:9876', timeoutMs: 100, minConfidence: 0.7, candidateLimit: 16 },
    })
    await h.assemble()
    const result = await search(h.ctx, h.agent, '我需要制作一张图片')
    expect(result.meta).toMatchObject({
      toolDiscovery: ['generate_image', 'list_image_models'],
      toolDiscoveryReasons: [
        { name: 'generate_image', reason: 'decision-model:0.91' },
        { name: 'list_image_models', reason: 'decision-model:0.06' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9876/decide')
    const request = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      context: '我需要制作一张图片',
      schema: { capability: { type: 'choice', options: expect.arrayContaining(['generate_image']) } },
    })
  })

  it('falls back to lexical discovery when the decision model is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    const h = await harness({
      decisionModel: { url: 'http://127.0.0.1:9876', timeoutMs: 100, minConfidence: 0.7, candidateLimit: 16 },
    })
    await h.assemble()
    const result = await search(h.ctx, h.agent, 'image')
    expect(result.meta).toMatchObject({
      toolDiscovery: ['generate_image', 'list_image_models'],
      toolDiscoveryReasons: [
        { name: 'generate_image', reason: 'lexical-match' },
        { name: 'list_image_models', reason: 'lexical-match' },
      ],
    })
  })

  it('filters denied tools before sending decision candidates', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      capability: { choice: 'list_image_models', confidence: 0.88, probabilities: { list_image_models: 0.88 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const h = await harness({
      decisionModel: { url: 'http://127.0.0.1:9876', timeoutMs: 100, minConfidence: 0.7, candidateLimit: 16 },
    })
    await h.assemble()
    h.agent.ctx.tools.restrict({ deny: ['generate_image'] })
    const result = await search(h.ctx, h.agent, 'image')
    expect(result.meta).toMatchObject({ toolDiscovery: ['list_image_models'] })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { schema: { capability: { options: string[]; instructions: string } } }
    expect(body.schema.capability.options).not.toContain('generate_image')
    expect(body.schema.capability.options).toContain('list_image_models')
    expect(body.schema.capability.instructions).toContain('list_image_models: List image models')
  })

  it('keeps exact rare matches ahead of frequent partial matches and evicts least recently used tools', async () => {
    const h = await harness({ maxTools: 3 })
    const history = h.ctx.sessions.create(SessionId('history'))
    appendCall(history, 'list_image_models', 'old')
    await h.assemble()
    const result = await search(h.ctx, h.agent, 'generate_image')
    expect(result.meta).toMatchObject({ toolDiscovery: ['generate_image'], toolDiscoveryReasons: [{ name: 'generate_image', reason: 'exact-name' }] })
    expect(await h.names()).toHaveLength(4)
    expect(await h.names()).toContain('read')
    await search(h.ctx, h.agent, 'speech')
    expect(await h.names()).toEqual(['generate_image', 'generate_speech', 'read', 'tool_search'])
    await search(h.ctx, h.agent, 'web_search')
    expect(await h.names()).not.toContain('generate_image')
  })

  it('does not expose or execute tools denied after assembly', async () => {
    const h = await harness()
    await h.assemble()
    h.agent.ctx.tools.restrict({ deny: ['generate_image', 'list_image_models'] })
    const result = await search(h.ctx, h.agent, 'image')
    expect(result.meta).toMatchObject({ toolDiscovery: [], toolDiscoveryReasons: [] })
    const denied = await h.ctx.tools.execute({ name: 'generate_image', callId: ToolCallId('denied'), arguments: {}, agent: h.agent, signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(await h.names()).not.toContain('generate_image')
  })

  it('restores committed selection without expanding back to the full catalog', async () => {
    const h = await harness()
    const assembly = await h.assemble()
    h.agent.session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' }, tools: assembly.tools } })
    await search(h.ctx, h.agent, 'speech')
    const expected = await h.names()
    await h.disposeDiscovery()
    await h.agent.ctx.plugin(Discovery, config)
    expect(await h.names()).toEqual(expected)
    expect(await h.names()).not.toContain('generate_image')
  })

  it('bounds a legacy request header when resuming a session', async () => {
    const h = await harness()
    const allTools = h.ctx.tools.schemas(h.agent)
    h.agent.session.append('request/header', {
      reason: 'initial',
      header: { config: { provider: 'fixture', model: 'fixture' }, tools: allTools },
    })

    await h.disposeDiscovery()
    await h.agent.ctx.plugin(Discovery, config)

    const names = await h.names()
    expect(names).toHaveLength(config.maxTools + 1)
    expect(names).toContain('tool_search')
  })

  it('bounds UTF-8 search output and rejects empty or wildcard-only queries', async () => {
    const h = await harness({ resultMaxBytes: 256, descriptionChars: 500 })
    h.ctx.tools.register(defineTool({ name: 'image_extra', description: `Image ${'图片'.repeat(400)}`, parameters: {},
      output: { schema: { type: 'string' }, render: () => [] }, async execute() { return '' },
    }))
    await h.assemble()
    const result = await search(h.ctx, h.agent, 'image')
    expect(result.isError).toBe(false)
    expect(Buffer.byteLength(JSON.stringify(JSON.parse(result.content[0]!.type === 'text' ? result.content[0]!.text : '{}')))).toBeLessThanOrEqual(256)
    for (const query of ['', '*', 'x'.repeat(161)]) expect((await search(h.ctx, h.agent, query)).isError).toBe(true)
    expect((await search(h.ctx, h.agent, 'nonexistent')).meta).toMatchObject({ toolDiscovery: [], toolDiscoveryReasons: [] })
  })

  it('retries after cancellation without retaining a rejected initialization', async () => {
    const h = await harness()
    const abort = new AbortController()
    abort.abort()
    await expect(h.ctx.systemPrompt.assemble(assembleContextFor(h.agent, abort.signal))).rejects.toThrow()
    expect(await h.names()).toHaveLength(4)
  })

  it('rejects impossible catalog budgets at mount', async () => {
    await expect(harness({ initialTools: 8 })).rejects.toThrow('initialTools')
  })

  it('restores a bounded safe set when a search misses', async () => {
    const h = await harness({ recoveryTools: ['web_search', 'generate_speech'] })
    await h.assemble()
    const result = await search(h.ctx, h.agent, 'no_such_capability')
    expect(result.meta).toMatchObject({
      toolDiscovery: ['generate_speech', 'web_search'],
      toolDiscoveryReasons: [
        { name: 'generate_speech', reason: 'safe-recovery' },
        { name: 'web_search', reason: 'safe-recovery' },
      ],
    })
    expect(await h.names()).toContain('web_search')
    expect(await h.names()).toContain('generate_speech')
  })
})
