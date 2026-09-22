/** Dedicated read-only repository view for the conversation workspace. */
import { useMemo } from 'react'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StepInsightInjected, GitCheckpointAudit } from './types.ts'
import { RepositoryFlow } from './RepositoryFlow.tsx'
import css from './ledger.module.css'

export type RepositoryViewProps = ConvViewProps & InjectFace<StepInsightInjected> & PropsLocale<'stepInsight'>

function checkpointsOf(entries: readonly SessionEventLikeEntry[]): GitCheckpointAudit[] {
  return entries.flatMap(entry => entry.type === 'event' && entry.event.type === 'agent/git-checkpoint'
    ? [entry.event.data]
    : [])
}

/** Render repository state independently from the Token ledger selection. */
export function RepositoryView({
  useLedgerEvents,
  loadOlder,
  workspacePath,
  cloneRepository,
  listRepositoryBranches,
  inspectRepository,
  pushRepository,
  t,
}: RepositoryViewProps) {
  const window = useLedgerEvents(value => value)
  const checkpoints = useMemo(() => checkpointsOf(window.entries), [window.entries])
  return <section className={css.repositoryRoot} aria-label={t('repositoryView')}>
    <header className={css.repositoryHeader}>
      <div>
        <h2>{t('repositoryView')}</h2>
        <p>{t('repositoryDescription')}</p>
      </div>
      {window.hasMore && <button type="button" onClick={() => { void loadOlder() }}>{t('loadOlder')}</button>}
    </header>
    <RepositoryFlow
      key={workspacePath ?? checkpoints.at(-1)?.cwd ?? 'unscoped'}
      checkpoints={checkpoints}
      t={t}
      {...(workspacePath === undefined ? {} : { workspacePath })}
      cloneRepository={cloneRepository}
      listRepositoryBranches={listRepositoryBranches}
      inspectRepository={inspectRepository}
      pushRepository={pushRepository}
    />
    {checkpoints.length === 0 && <p className={css.empty}>{t('repositoryNoData')}</p>}
    {window.hasMore && <p className={css.repositoryHint}>{t('partialHistory')}</p>}
  </section>
}
