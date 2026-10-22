/**
 * Pure projections over the checkout snapshot: what the panel groups, and how
 * each row reads.
 *
 * `git status --short` is the one source of truth here. Its two columns are the
 * index (staged) and the worktree; a file can appear in both at once, so the
 * panel lists a path once per column rather than once per file.
 */
import type { RepositoryChangeSnapshot, GitSyncState } from '@deepseek-ai/dsh-git-workspace'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

/** The file-kind vocabulary the panel labels rows with. */
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'other'

/** One path in one status column. */
export interface ChangeRow {
  /** Repository-relative path. */
  path: string
  /** The porcelain code that classified it (`M`, `A`, `??`, …). */
  code: string
  kind: ChangeKind
  /** Which column of the status this row came from. */
  staged: boolean
}

/** The two groups the panel draws, plus what it can say about the checkout. */
export interface ChangeGroups {
  staged: ChangeRow[]
  unstaged: ChangeRow[]
}

/**
 * Classify one porcelain code.
 * @param code - a one- or two-character status code, whitespace already trimmed.
 * @returns the row kind.
 */
function classify(code: string): ChangeKind {
  if (code === '??' || code.includes('?')) return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted'
  if (code.includes('R')) return 'renamed'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  if (code.includes('M')) return 'modified'
  return 'other'
}

/**
 * Split `git status --short` into the staged and unstaged groups.
 *
 * `git status` pads the index column to two characters, so ` M` is an unstaged
 * edit and `M ` a staged one; `??` is untracked and never staged.
 * @param status - the snapshot's status text, one entry per line.
 * @returns the two groups, each in git's own order.
 */
export function groupChanges(status: string): ChangeGroups {
  const staged: ChangeRow[] = []
  const unstaged: ChangeRow[] = []
  for (const raw of status.split(/\r?\n/u)) {
    if (raw.trim() === '') continue
    // Two status columns then the path; a path may itself contain spaces.
    const indexColumn = raw[0] ?? ' '
    const worktreeColumn = raw[1] ?? ' '
    const path = raw.slice(2).trim()
    if (path === '') continue
    const untracked = indexColumn === '?' && worktreeColumn === '?'
    if (untracked) {
      unstaged.push({ path, code: '??', kind: 'untracked', staged: false })
      continue
    }
    if (indexColumn !== ' ' && indexColumn !== '') {
      const code = indexColumn.trim()
      staged.push({ path, code, kind: classify(code), staged: true })
    }
    if (worktreeColumn !== ' ' && worktreeColumn !== '') {
      const code = worktreeColumn.trim()
      unstaged.push({ path, code, kind: classify(code), staged: false })
    }
  }
  return { staged, unstaged }
}

/** One row of the commit history list. */
export interface HistoryRow {
  sha: string
  shortSha: string
  message: string
  author: string
  /** Formatted local date, or an empty string when the commit has none. */
  date: string
}

/**
 * Project the snapshot's commits for the history list.
 * @param snapshot - the checkout snapshot.
 * @returns the rows, newest first.
 */
export function historyRows(snapshot: RepositoryChangeSnapshot | undefined): HistoryRow[] {
  return (snapshot?.commits ?? []).map(commit => ({
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    message: commit.message,
    author: commit.author,
    date: commit.date === null ? '' : new Date(commit.date).toLocaleString(),
  }))
}

/**
 * Label a change kind.
 * @param t - namespace-bound translate.
 * @param kind - the row's kind.
 * @returns the localized label.
 */
export function kindLabel(t: TranslateNS<'sidebarRepository'>, kind: ChangeKind): string {
  switch (kind) {
    case 'added': return t('fileAdded')
    case 'modified': return t('fileModified')
    case 'deleted': return t('fileDeleted')
    case 'renamed': return t('fileRenamed')
    case 'untracked': return t('fileUntracked')
    case 'conflicted': return t('fileConflicted')
    default: return t('fileOther')
  }
}

/**
 * Describe how the checkout relates to its upstream.
 * @param t - namespace-bound translate.
 * @param state - the snapshot's sync state.
 * @returns the localized sentence.
 */
export function syncLabel(t: TranslateNS<'sidebarRepository'>, state: GitSyncState): string {
  switch (state) {
    case 'synced': return t('syncSynced')
    case 'remote-ahead': return t('syncRemoteAhead')
    case 'local-ahead': return t('syncLocalAhead')
    case 'diverged': return t('syncDiverged')
    case 'different': return t('syncDifferent')
    default: return t('syncUnknown')
  }
}
