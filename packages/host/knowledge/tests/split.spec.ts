import { describe, expect, it } from 'vitest'
import { splitDocuments } from '../src/split.ts'

const document = {
  id: 'doc-1' as never,
  title: '指南',
  content: '# 标题\n\n' + '第一段。'.repeat(40),
  updatedAt: 1,
}

describe('knowledge splitting', () => {
  it('uses the same bounded splitter contract for recursive text', async () => {
    const chunks = await splitDocuments([document], { mode: 'recursive', size: 64, overlap: 2 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.content.length <= 64)).toBe(true)
    expect(chunks.map(chunk => chunk.ordinal)).toEqual(chunks.map((_chunk, index) => index))
  })

  it('keeps markdown headings in markdown mode and supports fixed mode', async () => {
    const markdown = await splitDocuments([document], { mode: 'markdown', size: 64, overlap: 0 })
    const fixed = await splitDocuments([document], { mode: 'fixed', size: 64, overlap: 0 })
    expect(markdown[0]?.content).toContain('# 标题')
    expect(fixed.every(chunk => chunk.content.length <= 64)).toBe(true)
  })

  it('rejects overlap that would not make progress', async () => {
    await expect(
      splitDocuments([document], { mode: 'fixed', size: 64, overlap: 64 }),
    ).rejects.toThrow('smaller than')
  })
})
