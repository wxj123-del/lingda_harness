import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import { frameSummary } from '../src/summarizer.ts'
import { writeCompactionSidecar } from '../src/sidecar.ts'

const SUMMARY = [
  { type: 'text' as const, text: '## Primary Request and Intent\n- Ship it' },
  { type: 'text' as const, text: '## Next Step\n- Run the tests' },
]

describe('compaction sidecar', () => {
  it('writes a private sidecar with front matter and the summary text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compaction-sidecar-'))
    try {
      const path = writeCompactionSidecar(root, {
        sessionId: SessionId('session-a'),
        compactionId: 'compaction-1',
        turn: 3,
        shadowedRange: { start: 1 as SessionSeq, end: 9 as SessionSeq },
        summary: SUMMARY,
      })
      expect(path.startsWith(root)).toBe(true)
      const body = await readFile(path, 'utf8')
      expect(body).toContain('compaction: compaction-1')
      expect(body).toContain('turn: 3')
      expect(body).toContain('shadowed: 1..9')
      expect(body).toContain('## Primary Request and Intent')
      expect(body).toContain('## Next Step\n- Run the tests')
      const mode = (await stat(path)).mode & 0o777
      expect(mode).toBe(0o600)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps sessions in separate directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compaction-sidecar-'))
    try {
      const first = writeCompactionSidecar(root, {
        sessionId: SessionId('one'),
        compactionId: 'c1',
        turn: null,
        shadowedRange: { start: 1 as SessionSeq, end: 2 as SessionSeq },
        summary: SUMMARY,
      })
      const second = writeCompactionSidecar(root, {
        sessionId: SessionId('two'),
        compactionId: 'c1',
        turn: null,
        shadowedRange: { start: 1 as SessionSeq, end: 2 as SessionSeq },
        summary: SUMMARY,
      })
      expect(first).not.toBe(second)
      expect((await stat(join(first, '..'))).mode & 0o777).toBe(0o700)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('names the sidecar path in the framed checkpoint', () => {
    const framed = frameSummary(SUMMARY, '/tmp/sidecar.md')
    const text = framed.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).toContain('<compaction-detail path="/tmp/sidecar.md">')
    expect(text).toContain('read it when a later checkpoint has folded detail you need')
  })

  it('omits the detail reference without a path', () => {
    const framed = frameSummary(SUMMARY)
    const text = framed.map(block => block.type === 'text' ? block.text : '').join('\n')
    expect(text).not.toContain('compaction-detail')
    expect(text).toContain('<compacted-summary>')
  })
})
