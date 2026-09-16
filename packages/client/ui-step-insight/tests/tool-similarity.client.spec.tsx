// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { InputPart } from '../src/client/types.ts'
import { compareTools } from '../src/client/tool-similarity.ts'
import { ToolSimilarityList } from '../src/client/ToolSimilarityList.tsx'
import { inspectInput } from '../src/client/input-parts.ts'
import { deriveSteps } from '../src/client/step-model.ts'
import { zh } from '../src/client/locales.ts'
import { entry, fixture, message } from './fixtures.client.ts'

afterEach(cleanup)

function user(text: string, seq = 1): InputPart {
  return { id: `user:${seq}`, seq, kind: 'user', source: '', text, userText: text, tokens: 10, media: false }
}

function schema(name: string, description: string): InputPart {
  return { id: name, seq: 2, kind: 'schema', source: name, text: description, tokens: 25, media: false,
    schema: { name, description } }
}

const image = schema('generateImage', 'Generate images from a prompt')
const read = schema('read_file', 'Read file contents')

describe('request-local tool similarity', () => {
  it.each(['帮我生成一张图片', 'Generate an image'])('matches multilingual image requests: %s', (text) => {
    const result = compareTools([user(text), read, image], 'latest')
    expect(result.comparisons[1]!.score).toBeGreaterThan(0)
    expect(result.comparisons[0]!.score).toBe(0)
    expect(result.comparisons[1]!.matches).toHaveLength(2)
    expect(result.comparisons[1]!.matches.map(match => match.tool)).toContain('image')
  })

  it('distinguishes unrelated text from absent, stopword-only or attachment-only text', () => {
    expect(compareTools([user('astronomy'), image], 'latest').comparisons[0]!.score).toBe(0)
    for (const text of ['', '请 帮我 一下', 'the please 123']) {
      expect(compareTools([user(text), image], 'latest').comparisons[0]!.score).toBeNull()
    }
    expect(compareTools([image], 'all').comparisons[0]!.score).toBeNull()
    const attachment = { ...user(''), text: '{"type":"image","file":"photo.png"}', media: true }
    expect(compareTools([attachment, image], 'latest').comparisons[0]!.score).toBeNull()
    expect(compareTools([user('image'), schema('', '')], 'latest').comparisons[0]!.score).toBeNull()
  })

  it('ignores repeated words and schema JSON properties', () => {
    const first = compareTools([user('generate image'), image], 'latest')
    const repeated = compareTools([user('generate image image image'), image], 'latest')
    expect(repeated.comparisons).toEqual(first.comparisons)
    const fileSchema = { ...read, text: '{"parameters":{"image":{"type":"string"}}}' }
    expect(compareTools([user('image'), fileSchema], 'latest').comparisons[0]!.score).toBe(0)
  })

  it('switches between the latest and retained user messages without including other roles', () => {
    const parts = [user('生成图片'), user('读取文件', 3), image, read]
    const latest = compareTools(parts, 'latest')
    expect(latest.sources.map(part => part.seq)).toEqual([3])
    expect(latest.comparisons[0]!.score).toBe(0)
    expect(latest.comparisons[1]!.score).toBeGreaterThan(0)
    expect(compareTools(parts, 'all').comparisons.every(row => row.score! > 0)).toBe(true)
    const excluded = ['system', 'assistant', 'context', 'tool'] as const
    expect(compareTools([...excluded.map(kind => ({ ...user('generate image'), kind })), image], 'all')
      .comparisons[0]!.score).toBeNull()
  })

  it('uses the selected historical prefix and applies its message replacements', () => {
    const events = fixture().slice(0, 9)
    events.push(entry(9, 'step/start', { turn: 1, step: 2 }),
      entry(10, 'user/message', createUserMessage({ content: [{ type: 'text', text: 'astronomy' }], source: { kind: 'user' } }),
        { op: 'replace', startSeq: 3 as SessionSeq, endSeq: 7 as SessionSeq }), message(11, 2),
      entry(12, 'user/message', createUserMessage({ content: [{ type: 'text', text: 'Read source' }], source: { kind: 'user' } }), 'append'))
    const rows = deriveSteps(events)
    const first = compareTools(inspectInput(events, rows[0]!, false).parts, 'all')
    const second = compareTools(inspectInput(events, rows[1]!, false).parts, 'all')
    expect(first.sources.map(part => part.seq)).toEqual([3])
    expect(first.comparisons[0]!.score).toBeGreaterThan(0)
    expect(second.sources.map(part => part.seq)).toEqual([10])
    expect(second.comparisons[0]!.score).toBe(0)
  })
})

describe('tool similarity inspection', () => {
  it('shows match evidence, sorts by score, switches reference and preserves token values', () => {
    const parts = [user('读取文件'), user('生成图片', 3), read, image]
    const view = render(<ToolSimilarityList parts={parts} tools={[]} t={key => zh[key]} />)
    const rows = () => [...view.container.querySelectorAll('[data-tool-schema]')]
    expect(rows().map(row => row.getAttribute('data-tool-schema'))).toEqual(['read_file', 'generateImage'])
    expect(screen.getByText('生成 ↔ generate')).toBeTruthy()
    expect(screen.getByText('图片 ↔ image')).toBeTruthy()
    expect(screen.getAllByText('~25 Token')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(zh.toolOrder), { target: { value: 'similarity' } })
    expect(rows()[0]!.getAttribute('data-tool-schema')).toBe('generateImage')
    expect(screen.getByRole('meter', { name: 'read_file 相似度' }).getAttribute('value')).toBe('0')
    fireEvent.change(screen.getByLabelText(zh.comparisonScope), { target: { value: 'all' } })
    expect(Number(screen.getByRole('meter', { name: 'read_file 相似度' }).getAttribute('value'))).toBeGreaterThan(0)
    expect(screen.getAllByText('~25 Token')).toHaveLength(2)
  })

  it('marks actual calls separately from relevance and handles an absent comparison', () => {
    const events = fixture()
    const row = deriveSteps(events)[0]!
    const parts = inspectInput(events, row, false).parts
    const view = render(<ToolSimilarityList parts={parts} tools={row.tools} t={key => zh[key]} />)
    expect(screen.getByText(zh.called)).toBeTruthy()
    expect(within(screen.getByRole('region')).getByText('~19 Token')).toBeTruthy()
    view.rerender(<ToolSimilarityList parts={[image]} tools={[]} t={key => zh[key]} />)
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText(zh.noComparisonText)).toBeTruthy()
    expect(screen.queryByText(zh.called)).toBeNull()
    view.rerender(<ToolSimilarityList parts={[]} tools={[]} t={key => zh[key]} />)
    expect(screen.queryByRole('region')).toBeNull()
  })
})
