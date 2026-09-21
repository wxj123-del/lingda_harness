import type { GitCheckpointAudit } from './types.ts'
import type { Translate } from './locales.ts'
import { gitSyncState, latestGitCheckpoint, parseGitDiffStat, parseGitStatus, shortSha, type GitFileStatus } from './git-view.ts'
import css from './ledger.module.css'

interface GitWorkspaceViewProps {
  checkpoints: readonly GitCheckpointAudit[]
  t: Translate
}

function fileLabel(file: GitFileStatus, t: Translate): string {
  const key = file.kind === 'modified' ? 'gitModified'
    : file.kind === 'added' ? 'gitAdded'
      : file.kind === 'deleted' ? 'gitDeleted'
        : file.kind === 'renamed' ? 'gitRenamed'
          : file.kind === 'untracked' ? 'gitUntracked'
            : file.kind === 'conflicted' ? 'gitConflicted' : 'gitOther'
  return `${t(key)} · ${file.code}`
}

/** Visualize the read-only Git evidence attached to one Agent request. */
export function GitWorkspaceView({ checkpoints, t }: GitWorkspaceViewProps) {
  const latest = latestGitCheckpoint(checkpoints)
  if (latest === undefined) return null
  const files = parseGitStatus(latest.status)
  const stat = parseGitDiffStat(latest.diffStat)
  const sync = gitSyncState(latest)
  const syncLabel = sync.label === 'synced' ? t('gitSyncSynced')
    : sync.label === 'remote-ahead' ? t('gitSyncRemoteAhead')
      : sync.label === 'local-ahead' ? t('gitSyncLocalAhead')
        : sync.label === 'diverged' ? t('gitSyncDiverged')
          : sync.label === 'different' ? t('gitSyncDifferent') : t('gitSyncUnknown')
  return <section className={css.gitWorkspace} aria-label={t('gitWorkspace')}>
    <header className={css.gitWorkspaceHeader}>
      <div>
        <h4>{t('gitWorkspace')}</h4>
        <span>{t('gitReadOnly')}</span>
      </div>
      {latest.branch && <code>{latest.branch}</code>}
    </header>
    <div className={css.gitCheckpointStrip}>
      {checkpoints.map((checkpoint, index) => <div key={`${checkpoint.phase}-${index}`} className={css.gitCheckpointCard}>
        <b>{t(checkpoint.phase === 'before' ? 'gitBefore' : 'gitAfter')}</b>
        <span>{checkpoint.repositoryRoot ?? checkpoint.cwd}</span>
        {checkpoint.remote && <small>{checkpoint.remote}</small>}
        {checkpoint.error && <small className={css.gitError}>{t('gitError')}: {checkpoint.error}</small>}
      </div>)}
    </div>
    {latest.error === undefined && <>
      <div className={css.gitMetricGrid}>
        <div><span>{t('gitWorktreeChanges')}</span><strong>{stat.files ?? files.length}</strong></div>
        <div><span>{t('gitInsertions')}</span><strong>{stat.insertions ?? '—'}</strong></div>
        <div><span>{t('gitDeletions')}</span><strong>{stat.deletions ?? '—'}</strong></div>
      </div>
      <div className={css.gitSyncPanel}>
        <div><span>{t('gitSyncStatus')}</span><strong>{syncLabel}</strong></div>
        <div><span>{t('gitLocalHead')}</span><code>{shortSha(latest.localHead)}</code></div>
        <div><span>{t('gitRemoteHead')}</span><code>{shortSha(latest.remoteHead ?? latest.upstreamHead)}</code></div>
        {latest.upstreamBranch && <div><span>{t('gitUpstream')}</span><code>{latest.upstreamBranch}</code></div>}
        {latest.remoteError && <p className={css.gitError}>{t('gitRemoteUnavailable')}: {latest.remoteError}</p>}
      </div>
      {files.length === 0
        ? <p className={css.gitClean}>{t('gitNoChanges')}</p>
        : <ul className={css.gitFileList}>{files.map((file, index) => <li key={`${file.code}-${file.path}-${index}`}>
          <span className={css.gitFileKind}>{fileLabel(file, t)}</span><code>{file.path}</code>
        </li>)}</ul>}
      {latest.diff && <details className={css.gitDiffDetails}>
        <summary>{t('gitDiff')} ({t('gitReadOnly')})</summary>
        <pre>{latest.diff}</pre>
      </details>}
      {latest.commits && latest.commits.length > 0 && <section className={css.commitTimeline} aria-label={t('gitRecentCommits')}>
        <header><b>{t('gitRecentCommits')}</b><span>{latest.commits.length}</span></header>
        <ol>{latest.commits.map(commit => <li key={commit.sha}>
          <span className={css.commitDot} />
          <div className={css.commitRow}><code>{shortSha(commit.sha)}</code><b>{commit.message}</b></div>
          <small>{commit.author || t('gitUnknownAuthor')}{commit.date === null ? '' : ` · ${new Date(commit.date).toLocaleString()}`}</small>
          {commit.files.length > 0 && <details className={css.commitFiles}><summary>{t('gitCommitFiles')} ({commit.files.length})</summary><ul>{commit.files.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>}
        </li>)}</ol>
      </section>}
    </>}
  </section>
}
