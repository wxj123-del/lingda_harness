/**
 * The pure projections over `git status --short` and the commit list.
 *
 * These are the panel's only decision points outside React, so they carry the
 * interesting cases: a path in both columns, a rename, an untracked file, and
 * a status line whose path contains spaces.
 */
import { describe, expect, it } from 'vitest'
import { groupChanges, historyRows, kindLabel, syncLabel } from '../src/client/state-view.ts'
import { zh } from '../src/client/locales.ts'
import type { RepositoryChangeSnapshot } from '@deepseek-ai/dsh-git-workspace'

// The dictionary's own lookup is the contract; the test reads it directly.
const t = ((key: keyof typeof zh) => zh[key]) as never

describe('groupChanges', () => {
  it('puts an index-column code in staged and a worktree code in unstaged', () => {
    const groups = groupChanges('M  src/staged.ts\n M src/unstaged.ts')
    expect(groups.staged.map(row => [row.path, row.code, row.kind])).toEqual([['src/staged.ts', 'M', 'modified']])
    expect(groups.unstaged.map(row => [row.path, row.code, row.kind])).toEqual([['src/unstaged.ts', 'M', 'modified']])
  })

  it('lists one path twice when both columns carry a code', () => {
    const groups = groupChanges('MM src/both.ts')
    expect(groups.staged.map(row => row.path)).toEqual(['src/both.ts'])
    expect(groups.unstaged.map(row => row.path)).toEqual(['src/both.ts'])
  })

  it('treats ?? as untracked and never staged', () => {
    const groups = groupChanges('?? src/new.ts')
    expect(groups.staged).toEqual([])
    expect(groups.unstaged).toEqual([{ path: 'src/new.ts', code: '??', kind: 'untracked', staged: false }])
  })

  it('keeps spaces inside a path', () => {
    const groups = groupChanges(' M docs/my notes.md')
    expect(groups.unstaged[0]?.path).toBe('docs/my notes.md')
  })

  it('reads staged additions, deletions, and renames', () => {
    const groups = groupChanges('A  a.ts\nD  b.ts\nR  c.ts -> d.ts')
    expect(groups.staged.map(row => row.kind)).toEqual(['added', 'deleted', 'renamed'])
  })

  it('reads a conflict as a conflict', () => {
    const groups = groupChanges('UU src/conflict.ts')
    expect(groups.staged[0]?.kind).toBe('conflicted')
    expect(groups.unstaged[0]?.kind).toBe('conflicted')
  })

  it('ignores a clean worktree', () => {
    expect(groupChanges('')).toEqual({ staged: [], unstaged: [] })
  })
})

describe('historyRows', () => {
  const snapshot = {
    commits: [{ sha: 'abcdef1234567', message: 'feat: x', author: 'Ada', date: '2026-10-17T09:00:00.000Z', files: [] }],
  } as unknown as RepositoryChangeSnapshot

  it('shortens the sha and keeps the subject', () => {
    expect(historyRows(snapshot).map(row => [row.shortSha, row.message, row.author]))
      .toEqual([['abcdef1', 'feat: x', 'Ada']])
  })

  it('has no rows without a snapshot', () => {
    expect(historyRows(undefined)).toEqual([])
  })
})

describe('labels', () => {
  it('names every change kind', () => {
    expect(kindLabel(t, 'untracked')).toBe('未跟踪')
    expect(kindLabel(t, 'conflicted')).toBe('冲突')
  })

  it('names every sync state, including unknown', () => {
    expect(syncLabel(t, 'synced')).toBe('已与远端一致')
    expect(syncLabel(t, 'diverged')).toBe('本地与远端已分叉')
    expect(syncLabel(t, 'unknown')).toBe('未知同步状态')
  })
})
