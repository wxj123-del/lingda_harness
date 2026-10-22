/** Synchronization state reported for a local checkout. */
export type GitSyncState = 'synced' | 'remote-ahead' | 'local-ahead' | 'diverged' | 'different' | 'unknown'

/** Repository state exposed to the Settings update row. */
export interface RepositoryUpdateStatus {
  repositoryRoot: string
  remote: string
  branch: string
  remoteBranch: string
  localHead: string
  remoteHead: string
  ahead: number
  behind: number
  state: 'current' | 'available' | 'local-ahead' | 'diverged' | 'blocked'
  reason?: string
}

/** Result returned after a successful source update. */
export interface RepositoryUpdateResult extends RepositoryUpdateStatus {
  updated: boolean
  restartScheduled: boolean
}

/** A user-requested remote checkout target. Paths are interpreted by the Host. */
export interface RepositoryCloneRequest {
  url: string
  targetDirectory: string
  branch?: string
}

/** Result of cloning a new checkout or fast-forwarding an existing checkout. */
export interface RepositoryCloneResult {
  repositoryRoot: string
  remote: string
  branch: string
  localHead: string
  remoteHead?: string
  action: 'cloned' | 'synced' | 'current'
  changed: boolean
}

/** Branch names advertised by a remote repository. */
export interface RepositoryBranchesResult {
  url: string
  branches: string[]
}

/** Repository root resolved from a directory, when that directory sits inside one. */
export interface RepositoryLocation {
  /** Absolute repository root; absent when the directory belongs to no repository. */
  repositoryRoot?: string
}

/** Explicit repository-relative paths for one staging operation. */
export interface RepositoryPathsRequest {
  repositoryRoot: string
  /** Paths exactly as `git status` reports them. */
  paths: string[]
}

/** One commit built from the worktree or from what is already staged. */
export interface RepositoryCommitRequest {
  repositoryRoot: string
  /** Commit subject. Blank is rejected rather than defaulting to a generic message. */
  message: string
  /**
   * Repository-relative paths to stage before committing; omit to commit every
   * change in the checkout.
   */
  paths?: string[]
  /** When paths are omitted, whether untracked files join the commit. */
  includeUntracked?: boolean
}

/** One commit as the history list shows it. */
export interface GitCommitAudit {
  sha: string
  message: string
  author: string
  date: string | null
  files: string[]
}

/** A bounded live view of one local checkout. */
export interface RepositoryChangeSnapshot {
  repositoryRoot: string
  remote?: string
  branch: string
  localHead: string
  upstreamBranch?: string
  upstreamHead?: string
  ahead: number
  behind: number
  syncState: GitSyncState
  status: string
  diffStat: string
  diff: string
  /** Recent commits, newest first; absent on a checkout with no commits yet. */
  commits?: GitCommitAudit[]
}

/** Result after one explicit commit. */
export interface RepositoryCommitResult extends RepositoryChangeSnapshot {
  /** SHA of the commit this call created. */
  commitSha: string
}

/** Explicit publish request from the repository surface. */
export interface RepositoryPushRequest {
  repositoryRoot: string
  message?: string
  includeUntracked?: boolean
}

/** Result after committing local changes and pushing the selected branch. */
export interface RepositoryPushResult extends RepositoryChangeSnapshot {
  committed: boolean
  pushed: boolean
  commitSha?: string
}
