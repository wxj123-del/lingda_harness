import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { readToolUsage } from '../src/tool-usage.ts'

type Event = SessionObservation['events'][number]
function event(type: string, data: object, time = 100): Event {
  return { type, data, seq: 1, time } as Event
}
function call(name: string, callId: string, time = 100): Event {
  return event('tool/call', { name, callId, turn: 1, step: 1, arguments: '{}' }, time)
}
function header(...names: string[]): Event {
  return event('request/header', { header: { tools: names.map(name => ({ name, description: name, parameters: {} })) } })
}
function response(calls: { name: string; id: string }[] = [], step = 1): Event {
  return event('assistant/message', { turn: 1, step, stream: [], message: { content: calls.map(call => ({ ...call, type: 'tool-call', arguments: '{}' })) } })
}
function observation(events: Event[], inheritedEventCount = 0): SessionObservation {
  return { events, inheritedEventCount, [Symbol.dispose]: vi.fn() } as unknown as SessionObservation
}
function reader(observations: (SessionObservation | Error)[]) {
  const observeSession = vi.fn(async (id: string) => {
    const value = observations[Number(id)]!
    if (value instanceof Error) throw value
    return value
  })
  return { observeSession, listSessions: vi.fn(async () => observations.map((_, index) => ({ header: { id: String(index) } }))) } as unknown as Context['sessionQuery']
}

describe('cross-session tool usage', () => {
  it('carries unchanged catalogs across requests and counts one hit for repeated calls in a response', async () => {
    const source = observation([
      header('read', 'unused'),
      response([{ name: 'read', id: 'a' }, { name: 'read', id: 'b' }]),
      call('read', 'a'), call('read', 'b'),
      event('assistant/attempt', { turn: 1, step: 2, stream: [] }),
      response([], 2),
      header('bash'), response([{ name: 'bash', id: 'c' }]), call('bash', 'c'),
    ])
    const result = await readToolUsage(reader([source]), new AbortController().signal)
    expect(result).toMatchObject({ requestCount: 4, unknownCatalogRequests: 0 })
    expect(result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'read', calls: 2, exposedRequests: 3, usedRequests: 1 }),
      expect.objectContaining({ name: 'unused', calls: 0, exposedRequests: 3, usedRequests: 0 }),
      expect.objectContaining({ name: 'bash', calls: 1, exposedRequests: 1, usedRequests: 1 }),
    ]))
  })

  it('uses inherited catalog state without counting inherited requests or PTC calls as native hits', async () => {
    const parent = observation([
      header('run_code'), response([{ name: 'run_code', id: 'a' }]), call('run_code', 'a'),
      event('tool/ptc-dispatch-start', { rootCallId: 'a', parentCallId: 'a', subCallId: 'inner', name: 'read', arguments: {} }),
    ])
    const fork = observation([...parent.events, response([], 2)], parent.events.length)
    const result = await readToolUsage(reader([parent, fork]), new AbortController().signal)
    expect(result).toMatchObject({ requestCount: 2, unknownCatalogRequests: 0 })
    expect(result.tools.find(tool => tool.name === 'run_code')).toMatchObject({ exposedRequests: 2, usedRequests: 1, calls: 1 })
    expect(result.tools.find(tool => tool.name === 'read')).toMatchObject({ exposedRequests: 0, usedRequests: 0, internalCalls: 1 })
  })

  it('distinguishes missing headers from tool-less requests and does not infer hits from unmatched calls', async () => {
    const result = await readToolUsage(reader([observation([
      response([{ name: 'read', id: 'a' }]), call('read', 'a'),
      header(), response(),
      header('read'), response([{ name: 'read', id: 'unexecuted' }]), call('read', 'different-id'),
    ])]), new AbortController().signal)
    expect(result).toMatchObject({ requestCount: 3, unknownCatalogRequests: 1 })
    expect(result.tools[0]).toMatchObject({ calls: 2, exposedRequests: 1, usedRequests: 0 })
  })

  it('attributes a call to the response catalog even after a later header change', async () => {
    const result = await readToolUsage(reader([observation([
      header('read'), response([{ name: 'read', id: 'a' }]), header('bash'), call('read', 'a'),
    ])]), new AbortController().signal)
    expect(result.tools.find(tool => tool.name === 'read')).toMatchObject({ exposedRequests: 1, usedRequests: 1 })
    expect(result.tools.find(tool => tool.name === 'bash')).toMatchObject({ exposedRequests: 0, usedRequests: 0 })
  })

  it('counts repeated calls across sessions, includes unused schemas, and ignores inherited history', async () => {
    const parent = observation([
      event('request/header', { header: { tools: [{ name: 'read' }, { name: 'unused' }] } }),
      call('read', 'a'), call('read', 'b', 200),
    ])
    const child = observation([...parent.events, call('bash', 'c', 300)], parent.events.length)
    const another = observation([call('read', 'a', 400)])
    const result = await readToolUsage(reader([parent, child, another]), new AbortController().signal)
    expect(result).toMatchObject({ sessionCount: 3, failedSessionCount: 0, tools: [
      { name: 'read', calls: 3, directCalls: 3, internalCalls: 0, sessions: 2, lastUsedAt: 400 },
      { name: 'bash', calls: 1, directCalls: 1, internalCalls: 0, sessions: 1, lastUsedAt: 300 },
      { name: 'unused', calls: 0, directCalls: 0, internalCalls: 0, sessions: 0, lastUsedAt: null },
    ] })
    for (const source of [parent, child, another]) expect(source[Symbol.dispose]).toHaveBeenCalledOnce()
  })

  it('counts PTC start and finish once, including failed or interrupted calls and legacy finishes', async () => {
    const data = { rootCallId: 'root', parentCallId: 'root', subCallId: 'one', name: 'read', arguments: {} }
    const source = observation([
      call('run_code', 'root'), event('tool/ptc-dispatch-start', data),
      event('tool/ptc-dispatch', { ...data, content: [], isError: true }),
      event('tool/ptc-dispatch-start', { ...data, subCallId: 'two' }),
      event('tool/ptc-dispatch', { ...data, subCallId: 'legacy', content: [], isError: false }),
    ])
    expect((await readToolUsage(reader([source]), new AbortController().signal)).tools[0])
      .toMatchObject({ name: 'read', calls: 3, directCalls: 0, internalCalls: 3, sessions: 1 })
  })

  it('reports unreadable sessions as partial and propagates cancellation', async () => {
    const result = await readToolUsage(reader([new Error('not found'), observation([call('read', 'x')])]), new AbortController().signal)
    expect(result).toMatchObject({ sessionCount: 1, failedSessionCount: 1 })
    const controller = new AbortController()
    controller.abort()
    await expect(readToolUsage(reader([observation([])]), controller.signal)).rejects.toThrow()
    expect((await readToolUsage(reader([]), new AbortController().signal)).tools).toEqual([])
  })

  it('does not count a PTC completion whose start belongs to inherited history', async () => {
    const data = { rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'read', arguments: {} }
    const parent = observation([call('run_code', 'root'), event('tool/ptc-dispatch-start', data)])
    const fork = observation([...parent.events, event('tool/ptc-dispatch', { ...data, content: [], isError: false })], 2)
    const result = await readToolUsage(reader([parent, fork]), new AbortController().signal)
    expect(result.tools.find(tool => tool.name === 'read')).toMatchObject({ calls: 1, sessions: 1 })
  })

  it('shows the most recently recorded definition regardless of session enumeration order', async () => {
    const newer = { name: 'read', description: 'Read text files', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
    const older = { ...newer, description: 'Older description' }
    const result = await readToolUsage(reader([
      observation([event('request/header', { header: { tools: [newer] } }, 300)]),
      observation([event('request/header', { header: { tools: [older] } }, 100), call('read', 'x', 400)]),
    ]), new AbortController().signal)
    expect(result.tools[0]).toMatchObject({ ...newer, calls: 1, lastUsedAt: 400 })
  })
})
