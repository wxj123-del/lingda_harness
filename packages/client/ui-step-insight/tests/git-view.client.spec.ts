import { describe, expect, it } from 'vitest'
import { latestGitCheckpoint, parseGitDiffStat, parseGitStatus } from '../src/client/git-view.ts'

describe('Git workspace projection', () => {
  it('parses short status into file kinds', () => {
    expect(parseGitStatus('## main\n M src/index.ts\nA  src/new.ts\n?? notes.md\nUU conflict.ts')).toEqual([
      { code: 'M', path: 'src/index.ts', kind: 'modified' },
      { code: 'A', path: 'src/new.ts', kind: 'added' },
      { code: '??', path: 'notes.md', kind: 'untracked' },
      { code: 'UU', path: 'conflict.ts', kind: 'conflicted' },
    ])
  })

  it('extracts diff counters and prefers the after checkpoint', () => {
    expect(parseGitDiffStat(' 3 files changed, 12 insertions(+), 4 deletions(-)')).toEqual({ files: 3, insertions: 12, deletions: 4 })
    const before = { turn: 1, phase: 'before' as const, cwd: '/repo' }
    const after = { turn: 1, phase: 'after' as const, cwd: '/repo' }
    expect(latestGitCheckpoint([before, after])).toBe(after)
  })
})
