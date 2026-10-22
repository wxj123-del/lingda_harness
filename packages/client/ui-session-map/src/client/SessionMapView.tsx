/**
 * Session map View: the viewed Session's turns as one spine, with every fork
 * hanging off the turn it branched from. Reads the `turnOutline` projection
 * and the Session list, so it needs no extra Host request.
 */
import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the `turnOutline` projection-key merge this View reads.
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'
import { buildSessionMap, type MapBranch, type MapChildInput, type MapRow } from './map.ts'
import type { SessionMapKey } from './locales.ts'
import css from './SessionMapView.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The session map View, its spine rows, and branch chips. */
    sessionMap: SessionMapKey
  }
}

/** Actions the map drives; both leave the View or change the Session. */
export interface SessionMapViewInjected {
  /** Fork the viewed Session after this turn and open the child. */
  forkAt: (seq: number) => Promise<void>
  /** Open one forked Session. */
  openSession: (id: SessionId) => void
}

/** Complete View props: the View runtime seat, its locale seat, and the map's actions. */
export type SessionMapViewProps =
  ConvViewProps
  & PropsLocale<'sessionMap'>
  & InjectFace<SessionMapViewInjected>

/** Child Sessions of `parentId`, newest first, with their inherited turn count. */
function mapChildren(list: SessionListState, parentId: SessionId): MapChildInput[] {
  const children: MapChildInput[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || summary.parentId !== parentId || summary.origin === 'subagent') continue
    const outline = summary.projectionValues?.turnOutline
    children.push({
      id: summary.id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      running: summary.running,
      turnCount: Array.isArray(outline) ? outline.length : undefined,
    })
  }
  return children
}

/** One branch chip: title, turn count, and a running marker. */
function BranchChip({ branch, onOpen, t }: {
  branch: MapBranch
  onOpen: (id: SessionId) => void
  t: SessionMapViewProps['t']
}) {
  const turns = branch.turns
  return (
    <button type="button" className={css.branch} onClick={() => { onOpen(branch.id) }}>
      <span className={css.branchTitle}>{branch.title}</span>
      <span className={css.branchMeta}>
        {turns === undefined
          ? t('map.branchTurnsUnknown')
          : t(turns === 1 ? 'map.branchTurns.one' : 'map.branchTurns.other', { n: turns })}
        {branch.running && <span className={css.branchRunning}>{t('map.branchRunning')}</span>}
      </span>
    </button>
  )
}

/** One spine row: the turn card plus the branches forked after it. */
function TurnRow({ row, disabled, onFork, onOpen, t }: {
  row: MapRow
  disabled: boolean
  onFork: (seq: number) => void
  onOpen: (id: SessionId) => void
  t: SessionMapViewProps['t']
}) {
  const { turn, branches } = row
  return (
    <li className={css.row}>
      <div className={css.spine} aria-hidden="true">
        <span className={css.node} />
      </div>
      <div className={css.rowBody}>
        <article className={css.turnCard}>
          <header className={css.turnHeader}>
            <span className={css.turnNumber}>{t('map.turn', { n: turn.turn })}</span>
            <button
              type="button"
              className={css.forkButton}
              disabled={disabled}
              title={disabled ? t('map.disabled') : t('map.branchHere')}
              onClick={() => { onFork(turn.seq) }}
            >
              {t('map.branchHere')}
            </button>
          </header>
          <p className={css.turnPrompt}>{turn.prompt === '' ? t('map.noPrompt') : turn.prompt}</p>
          {turn.response !== '' && <p className={css.turnResponse}>{turn.response}</p>}
        </article>
        {branches.length > 0 && (
          <div className={css.branches}>
            <span className={css.branchesLabel}>{t('map.branches')}</span>
            {branches.map(branch => (
              <BranchChip key={branch.id} branch={branch} onOpen={onOpen} t={t} />
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * Render the Session map.
 * @param props.useSession - viewed Session lifecycle state (fork gating).
 * @param props.useProjection - typed projection values, including `turnOutline`.
 * @param props.useSessions - the Session list, source of fork lineage.
 * @param props.sessionId - the viewed Session.
 * @param props.forkAt - fork after one turn and open the child.
 * @param props.openSession - open a forked Session.
 * @param props.t - the View's locale seat.
 * @returns the map element.
 */
export function SessionMapView({
  useSession, useProjection, useSessions, sessionId, forkAt, openSession, t,
}: SessionMapViewProps) {
  const running = useSession(state => state.running)
  const outline = useProjection('turnOutline')
  const list = useSessions(state => state)
  const [branching, setBranching] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const model = useMemo(
    () => buildSessionMap(outline, mapChildren(list, sessionId)),
    [list, outline, sessionId],
  )
  // `disabled` is the single gate: every row's button is disabled from the
  // render that follows this call, so the handler cannot run twice.
  const fork = (seq: number): void => {
    setBranching(seq)
    setError(null)
    forkAt(seq)
      .catch((caught: unknown) => {
        setError(t('map.forkFailed', {
          reason: caught instanceof Error ? caught.message : String(caught),
        }))
      })
      .finally(() => { setBranching(null) })
  }
  const disabled = running || branching !== null
  return (
    <div className={css.root}>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <h2 className={css.title}>{t('map.title')}</h2>
          <p className={css.subtitle}>{t('map.subtitle')}</p>
        </div>
        <span className={css.stats}>
          {t(model.turnCount === 1 ? 'map.turns.one' : 'map.turns.other', { n: model.turnCount })}
          {' · '}
          {t(model.branchCount === 1 ? 'map.branches.one' : 'map.branches.other', { n: model.branchCount })}
        </span>
      </header>
      {error !== null && <div className={css.error} role="alert">{error}</div>}
      {model.rows.length === 0
        ? (
          <div className={css.empty}>
            <span>{t('map.empty')}</span>
            <span className={css.emptyHint}>{t('map.emptyHint')}</span>
          </div>
        )
        : (
          <>
            <ol className={css.rows}>
              {model.rows.map(row => (
                <TurnRow
                  key={row.turn.turn}
                  row={row}
                  disabled={disabled}
                  onFork={fork}
                  onOpen={openSession}
                  t={t}
                />
              ))}
            </ol>
            {model.unattached.length > 0 && (
              <section className={clsx(css.branches, css.unattached)}>
                <span className={css.branchesLabel}>{t('map.unattached')}</span>
                <p className={css.emptyHint}>{t('map.unattachedHint')}</p>
                {model.unattached.map(branch => (
                  <BranchChip key={branch.id} branch={branch} onOpen={openSession} t={t} />
                ))}
              </section>
            )}
          </>
        )}
    </div>
  )
}
