import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import { createStepReader, deriveSteps } from '../src/client/step-model.ts'
import { inspectInput } from '../src/client/input-parts.ts'
import { readUsage } from '../src/client/usage.ts'
import { entry, fixture, live, message, usage } from './fixtures.client.ts'

describe('per-attempt provider accounting', () => {
  it('counts cache buckets once and treats reasoning as an output subset', () => {
    const rows = deriveSteps(fixture())
    expect(rows).toHaveLength(2)
    expect(rows[0]?.usage).toMatchObject({ prompt: 1000, output: 200, reasoning: 50, total: 1200 })
    expect(rows.reduce((total, row) => total + row.usage.total!, 0)).toBe(2500)
    expect(rows[0]?.tools).toHaveLength(1)
    expect(rows[0]?.tools[0]?.result).toEqual([{ type: 'text', text: 'export const source = 1' }])
  })

  it('keeps missing cache buckets and missing totals unknown instead of zero', () => {
    expect(readUsage({ inputTokens: 10, outputTokens: 4 })).toMatchObject({ total: null, prompt: null, cacheRead: null })
    expect(readUsage({ inputTokens: 10, outputTokens: 4, totalTokens: 30 })).toMatchObject({ total: 30, prompt: 26, unclassified: 16 })
    expect(readUsage({ inputTokens: 10, outputTokens: 4, totalTokens: 3 }).total).toBeNull()
    expect(readUsage({ ...usage, totalTokens: 9999 }).total).toBeNull()
    expect(readUsage({ ...usage, reasoningTokens: 201 }).reasoning).toBeNull()
    expect(readUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }).total).toBe(0)
  })

  it('preserves billed failed attempts beside a successful retry', () => {
    const rows = deriveSteps([
      ...fixture().slice(0, 5),
      entry(5, 'assistant/attempt', { turn: 1, step: 1, stream: [
        { type: 'chunk', time: 450, chunk: { type: 'usage', usage: { ...usage, totalTokens: 1100, outputTokens: 100 } } },
      ] }),
      message(6, 1, usage),
    ])
    expect(rows.map(row => [row.attempt, row.status, row.usage.total])).toEqual([[1, 'attempt', 1100], [2, 'complete', 1200]])
  })

  it('uses latest live usage and replaces transient output with one durable settlement', () => {
    const prefix = fixture().slice(0, 5)
    const first = live(4.1, 'Hello')
    const second = live(4.2, ' world')
    expect(deriveSteps([...prefix, first, second])[0]).toMatchObject({ status: 'streaming', output: [{ type: 'text', text: 'Hello world' }] })
    const usageEntry = { ...first, event: { ...first.event, seq: 4.3, data: { ...first.event.data, chunk: { type: 'usage', usage } } } } as typeof first
    const changed = { ...usageEntry, event: { ...usageEntry.event, seq: 4.4, data: { ...usageEntry.event.data, chunk: { type: 'usage', usage: { ...usage, outputTokens: 220, totalTokens: 1220 } } } } } as typeof first
    expect(deriveSteps([...prefix, first, usageEntry, changed])[0]?.usage.total).toBe(1220)
    const settled = deriveSteps([...prefix, message(5, 1, usage)])
    expect(settled).toHaveLength(1)
    expect(settled[0]?.usage.total).toBe(1200)
  })

  it('closes interrupted streams without inventing reported usage', () => {
    const rows = deriveSteps([...fixture().slice(0, 5), live(4.1, 'Partial'), entry(5, 'turn/end', { turn: 1, reason: { kind: 'interrupted' } })])
    expect(rows[0]).toMatchObject({ status: 'interrupted', usage: { total: null } })
  })

  it('marks tool-only paged history as unreported instead of an active model request', () => {
    const rows = deriveSteps(fixture().slice(7, 9))
    expect(rows[0]).toMatchObject({ status: 'unreported', usage: { total: null },
      tools: [{ startTime: null, endTime: 700 }] })
    expect(deriveSteps([live(4.1, 'Partial')])[0]?.startTime).toBeNull()
  })

  it('retains text and usage while a media block is still open', () => {
    const chunk = live(4.2, '')
    if (chunk.type !== 'transient') throw new Error('Expected a live fixture')
    const open = { ...chunk, event: { ...chunk.event, data: { ...chunk.event.data,
      chunk: { type: 'block-start' as const, index: 1, blockType: 'image' as const } } } }
    const rows = deriveSteps([...fixture().slice(0, 5), live(4.1, 'Visible'), open])
    expect(rows[0]).toMatchObject({ status: 'streaming', output: [{ type: 'text', text: 'Visible' }] })
  })

  it('folds new chunks without reading full history and rebuilds on settlement or paging', () => {
    const source = new MutableSessionEventSource()
    source.replace(fixture().slice(1, 5), true)
    const read = createStepReader()
    const before = read(source.getSnapshot())
    expect(before[0]).toMatchObject({ model: 'audit-model', status: 'waiting' })
    source.append(live(4.1, 'Partial'))
    const append = source.getSnapshot()
    const incremental = read({ ...append, get entries(): never { throw new Error('Append must not scan history') } })
    expect(incremental[0]?.output).toEqual([{ type: 'text', text: 'Partial' }])
    expect(before[0]?.output).toEqual([])
    source.settleAssistant('live-1' as never, message(5, 1, usage) as never)
    expect(read(source.getSnapshot())).toEqual(deriveSteps(source.getSnapshot().entries))
    source.prepend(fixture().slice(0, 1), false)
    const paged = read(source.getSnapshot())
    expect(paged).toEqual(deriveSteps(source.getSnapshot().entries))
    expect(read(source.getSnapshot())).toBe(paged)
    source.append(entry(6, 'step/end', { turn: 1, step: 1 }))
    source.append(entry(7, 'step/start', { turn: 1, step: 2 }))
    expect(read(source.getSnapshot())).toEqual(deriveSteps(source.getSnapshot().entries))
  })

  it('records compaction separately and refuses to infer its input prompt', () => {
    const id = 'compact-1' as CompactionId
    const events = [...fixture(), entry(13, 'compaction/start', { compactionId: id, turn: null }),
      entry(14, 'compaction/summary', { compactionId: id, summary: [], shadowedRange: { start: 3 as SessionSeq, end: 7 as SessionSeq },
        shadowedSeqs: [], shadowedTokenCount: 20, provider: 'fixture', model: 'compact-model', usage }),
      entry(15, 'compaction/end', { compactionId: id, turn: null })]
    const row = deriveSteps(events).at(-1)!
    expect(row).toMatchObject({ kind: 'compaction', model: 'compact-model', usage: { total: 1200 } })
    expect(inspectInput(events, row, false)).toMatchObject({ parts: [], incomplete: true })
  })
})

describe('input source attribution', () => {
  it('attributes tool results only to subsequent requests and includes unused tool schemas', () => {
    const events = fixture()
    const rows = deriveSteps(events)
    expect(inspectInput(events, rows[0]!, false).parts.map(part => part.kind)).toEqual(['system', 'user', 'schema'])
    const next = inspectInput(events, rows[1]!, false)
    expect(next.parts.map(part => part.kind)).toEqual(['system', 'user', 'assistant', 'tool', 'schema'])
    expect(next.parts.find(part => part.kind === 'tool')?.source).toBe('read-1')
  })

  it('applies recorded replacements instead of charging removed history again', () => {
    const events = fixture().slice(0, 9)
    events.push(entry(9, 'step/start', { turn: 1, step: 2 }),
      entry(10, 'user/message', createUserMessage({ content: [{ type: 'text', text: 'Compact summary' }], source: { kind: 'user' } }),
        { op: 'replace', startSeq: 3 as SessionSeq, endSeq: 7 as SessionSeq }), message(11, 2, usage))
    const input = inspectInput(events, deriveSteps(events)[1]!, false)
    expect(input.parts.map(part => part.kind)).toEqual(['system', 'user', 'schema'])
    expect(input.parts[1]?.text).toBe('Compact summary')
    expect(input.incomplete).toBe(false)
    expect(inspectInput(events.slice(5), deriveSteps(events)[1]!, true).incomplete).toBe(true)
  })
})
