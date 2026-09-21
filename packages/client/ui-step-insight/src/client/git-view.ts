import type { GitCheckpointAudit, GitSyncState } from './types.ts'

/** One file-level worktree status projected from `git status --short`. */
export interface GitFileStatus {
  code: string
  path: string
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'other'
}

export interface GitSyncSummary {
  state: GitSyncState | 'unknown'
  label: 'synced' | 'remote-ahead' | 'local-ahead' | 'diverged' | 'different' | 'unknown'
}

/** Parse the bounded short-status text recorded in a Git checkpoint. */
export function parseGitStatus(status: string | undefined): GitFileStatus[] {
  if (status === undefined || status.trim() === '') return []
  return status.split(/\r?\n/u).map(line => line.trimEnd()).filter(line => line && !line.startsWith('## ')).map((line) => {
    const match = /^(?<code>.{1,2})\s+(?<path>.+)$/u.exec(line)
    const groups = match?.groups
    if (groups === undefined || groups.code === undefined || groups.path === undefined)
      return { code: '??', path: line, kind: 'other' as const }
    const code = groups.code.trim() || ' '
    const path = groups.path
    const kind = classifyStatus(code)
    return { code, path, kind }
  })
}

function classifyStatus(code: string): GitFileStatus['kind'] {
  if (code.includes('?')) return 'untracked'
  if (code.includes('U')) return 'conflicted'
  if (code.includes('R')) return 'renamed'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  if (code.includes('M')) return 'modified'
  return 'other'
}

/** Extract the compact counters printed by `git diff --stat`. */
export function parseGitDiffStat(stat: string | undefined): { files: number | null; insertions: number | null; deletions: number | null } {
  if (stat === undefined || stat.trim() === '') return { files: null, insertions: null, deletions: null }
  const files = /([\d,]+) files? changed/u.exec(stat)?.[1]
  const insertions = /([\d,]+) insertion(?:s|)/u.exec(stat)?.[1]
  const deletions = /([\d,]+) deletion(?:s|)/u.exec(stat)?.[1]
  const number = (value: string | undefined): number | null => value === undefined ? null : Number(value.replaceAll(',', ''))
  return { files: number(files), insertions: number(insertions), deletions: number(deletions) }
}

/** Return the after checkpoint when present, otherwise the latest checkpoint. */
export function latestGitCheckpoint(checkpoints: readonly GitCheckpointAudit[]): GitCheckpointAudit | undefined {
  return checkpoints.findLast(checkpoint => checkpoint.phase === 'after') ?? checkpoints.at(-1)
}

/** Prefer the explicit checkpoint state while remaining compatible with old logs. */
export function gitSyncState(checkpoint: GitCheckpointAudit | undefined): GitSyncSummary {
  if (checkpoint?.syncState !== undefined) return { state: checkpoint.syncState, label: checkpoint.syncState }
  if (checkpoint?.localHead !== undefined && checkpoint.upstreamHead !== undefined)
    return { state: checkpoint.localHead === checkpoint.upstreamHead ? 'synced' : 'different', label: checkpoint.localHead === checkpoint.upstreamHead ? 'synced' : 'different' }
  return { state: 'unknown', label: 'unknown' }
}

export function shortSha(sha: string | undefined): string {
  return sha === undefined ? '—' : sha.slice(0, 7)
}
