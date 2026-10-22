/**
 * The source-control panel: branch line, staged group, changed group, commit
 * box, and recent history — the shape a developer already knows from an IDE's
 * source-control view, sized for a sidebar column rather than a page.
 *
 * Everything the panel keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component decides only what to
 * draw for a snapshot and what a click means.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconRefreshOutline16, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeRow } from './state-view.ts'
import { groupChanges, historyRows, kindLabel, syncLabel } from './state-view.ts'
import type {} from './locales.ts'
import type { createRepositoryStore } from './store.ts'
import css from './RepositoryBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type RepositoryBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createRepositoryStore>>
  & import('./face.ts').RepositoryInjected
  & PropsLocale<'sidebarRepository'>

/** How many history rows the panel lists before it stops. */
const HISTORY_LIMIT = 8

/**
 * Draw one change row with its per-row staging action.
 * @param props - the row, its group, and the handlers that act on it.
 * @returns the list item.
 */
function ChangeItem({ row, staged, busy, onApply, t }: {
  row: ChangeRow
  staged: boolean
  busy: boolean
  onApply: (row: ChangeRow, staged: boolean) => void
  t: RepositoryBodyProps['t']
}): ReactNode {
  // The path is the row's identity; the base name is what the reader scans for.
  const slash = row.path.lastIndexOf('/')
  const directory = slash < 0 ? '' : row.path.slice(0, slash + 1)
  const name = slash < 0 ? row.path : row.path.slice(slash + 1)
  return (
    <li className={css.row} data-row-kind={row.kind} data-row-staged={staged}>
      <span className={css.rowCode} aria-hidden="true">{row.code}</span>
      <span className={css.rowPath} title={row.path}>
        {directory !== '' && <span className={css.rowDirectory}>{directory}</span>}
        <span className={css.rowName}>{name}</span>
      </span>
      <span className={css.rowKind}>{kindLabel(t, row.kind)}</span>
      <button
        type="button"
        className={css.rowAction}
        disabled={busy}
        aria-label={`${staged ? t('unstage') : t('stage')}: ${row.path}`}
        title={staged ? t('unstage') : t('stage')}
        onClick={() => { onApply(row, staged) }}
      >
        {staged ? '−' : '+'}
      </button>
    </li>
  )
}

/** The source-control panel body. */
export function RepositoryBody({
  useTabInfo, sessionId, useSessions, useStore, actions, start, reload, apply, commit, pull, t,
}: RepositoryBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-repository-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  if (state.repositoryRoot === undefined && state.pending === 'read') {
    return (
      <div className={css.status} data-repository-state="loading">
        <p className={css.statusLine}>{t('loading')}</p>
      </div>
    )
  }
  if (state.repositoryRoot === undefined) {
    return (
      <div className={css.status} data-repository-state="no-repository">
        <p className={css.statusLine}>{t('noRepository')}</p>
        <p className={css.statusHint}>{t('noRepositoryHint')}</p>
        <Button size="sm" variant="outline" onClick={() => { reload(tab.id, signal) }}>{t('reload')}</Button>
      </div>
    )
  }

  const snapshot = state.snapshot
  const groups = groupChanges(snapshot?.status ?? '')
  const history = historyRows(snapshot)
  const busy = state.pending !== undefined
  // A change is committable when something is staged; the commit box says so.
  const canCommit = state.pending !== 'commit' && groups.staged.length > 0 && state.message.trim() !== ''
  const onApply = (row: ChangeRow, staged: boolean): void => {
    apply(tab.id, [row.path], !staged, signal)
  }
  const ahead = snapshot?.ahead ?? 0
  const behind = snapshot?.behind ?? 0

  return (
    <div className={css.root} data-repository-state="ready">
      <div className={css.branch}>
        <span className={css.branchName} title={snapshot?.remote}>
          {snapshot?.branch === undefined || snapshot.branch === '' ? t('detachedHead') : snapshot.branch}
        </span>
        <span className={css.branchSpacer} />
        {behind > 0 && <Tag tone="warning">{t('behind', { count: behind })}</Tag>}
        {ahead > 0 && <Tag tone="info">{t('ahead', { count: ahead })}</Tag>}
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          disabled={busy}
          onClick={() => { reload(tab.id, signal) }}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      {snapshot !== undefined && <p className={css.sync}>{syncLabel(t, snapshot.syncState)}</p>}

      {state.failure !== undefined && (
        <p className={css.error} role="alert">{t('error.unavailable', { message: state.failure.message })}</p>
      )}
      {state.notice !== undefined && (
        <p className={css.notice} role="status">{t('commitDone', { sha: state.notice })}</p>
      )}

      <section className={css.group} aria-label={t('staged')}>
        <header className={css.groupHeader}>
          <span className={css.groupTitle}>{t('staged')}</span>
          <span className={css.groupCount}>{groups.staged.length}</span>
          {groups.staged.length > 0 && <button
            type="button"
            className={css.groupAction}
            disabled={busy}
            onClick={() => { apply(tab.id, groups.staged.map(row => row.path), false, signal) }}
          >{t('unstageAll')}</button>}
        </header>
        {groups.staged.length === 0
          ? <p className={css.empty}>{t('nothingStaged')}</p>
          : <ul className={css.list}>
            {groups.staged.map(row => <ChangeItem
              key={`staged:${row.path}`}
              row={row}
              staged
              busy={busy}
              onApply={onApply}
              t={t}
            />)}
          </ul>}
      </section>

      <section className={css.group} aria-label={t('changes')}>
        <header className={css.groupHeader}>
          <span className={css.groupTitle}>{t('changes')}</span>
          <span className={css.groupCount}>{groups.unstaged.length}</span>
          {groups.unstaged.length > 0 && <button
            type="button"
            className={css.groupAction}
            disabled={busy}
            onClick={() => { apply(tab.id, groups.unstaged.map(row => row.path), true, signal) }}
          >{t('stageAll')}</button>}
        </header>
        {groups.unstaged.length === 0
          ? <p className={css.empty}>{t('clean')}</p>
          : <ul className={css.list}>
            {groups.unstaged.map(row => <ChangeItem
              key={`unstaged:${row.path}`}
              row={row}
              staged={false}
              busy={busy}
              onApply={onApply}
              t={t}
            />)}
          </ul>}
      </section>

      <div className={css.commit}>
        <Input
          aria-label={t('commitPlaceholder')}
          value={state.message}
          placeholder={t('commitPlaceholder')}
          disabled={state.pending === 'commit'}
          onChange={(event) => { actions.typed(tab.id, event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCommit) commit(tab.id, state.message, signal)
          }}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={!canCommit}
          onClick={() => { commit(tab.id, state.message, signal) }}
        >{state.pending === 'commit' ? t('committing') : t('commit')}</Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || snapshot?.upstreamBranch === undefined}
          onClick={() => { pull(tab.id, signal) }}
        >{state.pending === 'pull' ? t('pulling') : t('pull')}</Button>
      </div>

      <section className={css.group} aria-label={t('history')}>
        <header className={css.groupHeader}>
          <span className={css.groupTitle}>{t('history')}</span>
        </header>
        {history.length === 0
          ? <p className={css.empty}>{t('noHistory')}</p>
          : <ol className={css.history}>
            {history.slice(0, HISTORY_LIMIT).map(row => <li key={row.sha} className={css.historyRow}>
              <code className={css.historySha} title={row.sha}>{row.shortSha}</code>
              <span className={css.historyMessage} title={row.message}>{row.message}</span>
              {row.date !== '' && <small className={css.historyMeta}>{row.author} · {row.date}</small>}
            </li>)}
          </ol>}
      </section>
    </div>
  )
}
