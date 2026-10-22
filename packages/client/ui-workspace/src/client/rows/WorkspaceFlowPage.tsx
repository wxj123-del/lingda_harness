/**
 * The Workspace flow page: a full-width board filing every Session of one
 * Workspace into its lifecycle stage. Presentation only — stage groups arrive
 * from the workspace flow derivation, and the page re-derives them from live
 * list facts on each snapshot.
 */
import { useId, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutline14, IconListPenOutline16, IconRightUpOutline16, Menu,
  relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { deriveWorkspaceFlow, type SessionFlowStage, type SessionFlowItem } from '../flow.ts'
import type { WorkspaceFlowPageProps } from '../contract/slots.ts'
import type { WorkspaceKey } from '../locales.ts'
import css from './WorkspaceFlowPage.module.css'

const STAGE_LABEL = {
  waiting: 'flow.stage.waiting',
  working: 'flow.stage.working',
  progress: 'flow.stage.progress',
  todo: 'flow.stage.todo',
  done: 'flow.stage.done',
} as const satisfies Record<SessionFlowStage, WorkspaceKey>

/**
 * Navigation-bar glyph of the flow page (the `shell.navigation.panels` entry).
 * @param props.size - requested square edge in pixels.
 * @returns the flow glyph at the requested size.
 */
export function FlowPanelIcon({ size }: { size: number }) {
  return <IconListPenOutline16 size={size} />
}

/** The stage colour dot, shared by column headers and card accents. */
function StageDot({ stage }: { stage: SessionFlowStage }) {
  return <span className={clsx(css.stageDot, css[stage])} aria-hidden="true" />
}

/** Compact relative time through the workspace dictionary ("now"/"5min" in en, "刚刚"/"5分钟" in zh). */
function timeLabel(updatedAt: number, now: number, t: WorkspaceFlowPageProps['t']): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Status marker for one task-list entry (the three portable todo states). */
function taskMarker(status: TodoItem['status']): string {
  switch (status) {
    case 'completed': return '✓'
    case 'in_progress': return '▸'
    case 'pending': return '○'
    /* v8 ignore next -- TodoItem.status is a closed three-variant union. */
    default: return '○'
  }
}

/** One task-list entry with its completion state. */
function TaskRow({ item }: { item: TodoItem }) {
  return (
    <li className={clsx(css.task, item.status === 'completed' && css.taskDone)}>
      <span className={css.taskMarker} aria-hidden="true">{taskMarker(item.status)}</span>
      <span className={css.taskText}>{item.content}</span>
    </li>
  )
}

/**
 * One Session card. The summary row expands in place to the work itself — the
 * task list and each turn's prompt/response previews — so reading what a
 * conversation finished does not require leaving the board. Opening the
 * Session stays a separate, explicit action.
 */
function FlowCard({ item, now, onOpen, t }: {
  item: SessionFlowItem
  now: number
  onOpen: (id: SessionId) => void
  t: WorkspaceFlowPageProps['t']
}) {
  const title = item.blank ? t('session.new') : item.title
  const percent = item.todoTotal === 0 ? 0 : Math.round(item.todoDone / item.todoTotal * 100)
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const hasDetail = item.todos.length > 0 || item.turns.length > 0 || item.stats !== undefined
  return (
    <div className={clsx(css.card, expanded && css.cardExpanded)}>
      <button
        type="button"
        className={css.cardSummary}
        aria-expanded={hasDetail ? expanded : undefined}
        aria-controls={hasDetail ? detailId : undefined}
        onClick={() => { if (hasDetail) setExpanded(open => !open) }}
      >
        <span className={css.cardTitle}>{title}</span>
        <span className={css.cardMeta}>
          {item.stats !== undefined && (
            <span className={css.cardStats}>
              {t('flow.card.stats', { turns: item.stats.turns, steps: item.stats.steps })}
            </span>
          )}
          {!item.blank && <span className={css.cardTime}>{timeLabel(item.updatedAt, now, t)}</span>}
          {item.todoTotal > 0 && (
            <span className={css.cardSteps}>{t('flow.steps', { done: item.todoDone, total: item.todoTotal })}</span>
          )}
          {hasDetail && (
            <span className={clsx(css.chevron, expanded && css.chevronOpen)} aria-hidden="true">
              <IconChevronDownOutline14 />
            </span>
          )}
        </span>
        {item.todoTotal > 0 && (
          <span className={css.track} aria-hidden="true">
            <span className={css.fill} style={{ width: `${percent}%` }} />
          </span>
        )}
      </button>
      {expanded && (
        <div className={css.detail} id={detailId}>
          {item.todos.length > 0 && (
            <section className={css.detailSection}>
              <h3 className={css.detailTitle}>{t('flow.card.tasks')}</h3>
              <ul className={css.taskList}>
                {item.todos.map((task, index) => (
                  <TaskRow key={`${index}-${task.content}`} item={task} />
                ))}
              </ul>
            </section>
          )}
          {item.turns.length > 0 && (
            <section className={css.detailSection}>
              <h3 className={css.detailTitle}>{t('flow.card.turns')}</h3>
              <ol className={css.turnList}>
                {item.turns.map(turn => (
                  <li key={turn.turn} className={css.turn}>
                    <span className={css.turnPrompt}>{turn.prompt === '' ? t('flow.card.noPrompt') : turn.prompt}</span>
                    {turn.response !== '' && <span className={css.turnResponse}>{turn.response}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className={css.detailActions}>
            <button type="button" className={css.openButton} onClick={() => { onOpen(item.id) }}>
              <IconRightUpOutline16 size={14} />
              <span>{t('flow.card.open')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Render the flow page for the currently targeted Workspace.
 * @param props.useSessions - session list snapshot hook.
 * @param props.useWorkspaces - workspace snapshot hook.
 * @param props.useSessionPendingInteraction - pending interaction hook.
 * @param props.useStore - the shared viewing store; its `flowTarget` names the Workspace to show.
 * @param props.actions - the shared viewing store's write face (retargeting the page).
 * @param props.open - open one Session from a stage card.
 * @param props.close - return to the Conversation.
 * @param props.t - the workspace locale seat.
 * @returns the page element.
 */
export function WorkspaceFlowPage({
  useSessions, useWorkspaces, useSessionPendingInteraction,
  useStore, actions, open, close, t,
}: WorkspaceFlowPageProps) {
  // Persisted state written before this key existed rehydrates without it.
  const target = useStore(state => state.flowTarget) ?? null
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pendingInteractions = useSessionPendingInteraction(state => state)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const workspace = target === null
    ? undefined
    : workspaces.find(candidate => (candidate.workspaceId as string) === target)
  const groups = useMemo(
    () => workspace === undefined
      ? []
      : deriveWorkspaceFlow(list, workspace, archivedSessionIds, pendingInteractions),
    [archivedSessionIds, list, pendingInteractions, workspace],
  )
  const total = groups.reduce((count, group) => count + group.items.length, 0)
  const done = groups.find(group => group.stage === 'done')?.items.length ?? 0
  return (
    <div className={css.root}>
      <header className={css.header}>
        <div className={css.titleBlock}>
          <h1 className={css.title}>
            {workspace === undefined ? t('flow.page.title') : workspace.title}
          </h1>
          <p className={css.subtitle}>
            {workspace === undefined
              ? t('flow.page.pick')
              : total === 0 ? t('flow.empty') : t('flow.summary', { total, done })}
          </p>
        </div>
        <div className={css.headerActions}>
          <Menu
            open={switcherOpen}
            onClose={() => { setSwitcherOpen(false) }}
            items={workspaces.map(candidate => ({ id: candidate.workspaceId as string, label: candidate.title }))}
            selectedId={target === null ? undefined : target}
            onSelect={(id) => {
              setSwitcherOpen(false)
              actions.setFlowTarget(id)
            }}
            align="end"
            dense
            // Portal: the header row clips overflow, so an in-place list would
            // be cut off at its bounds.
            portal
            anchor={(
              <Button variant="outline" onClick={() => { setSwitcherOpen(open => !open) }}>
                {t('flow.page.switch')}
              </Button>
            )}
          />
          <Button variant="primary" onClick={close}>{t('flow.page.back')}</Button>
        </div>
      </header>
      <div className={css.board}>
        {groups.map(group => (
          <section key={group.stage} className={css.column} aria-label={t(STAGE_LABEL[group.stage])}>
            <header className={css.columnHeader}>
              <StageDot stage={group.stage} />
              <h2 className={css.columnTitle}>{t(STAGE_LABEL[group.stage])}</h2>
              <span className={css.columnCount}>{group.items.length}</span>
            </header>
            <div className={css.cards}>
              {group.items.map(item => (
                <FlowCard key={item.id} item={item} now={Date.now()} onOpen={open} t={t} />
              ))}
              {group.items.length === 0 && <p className={css.columnEmpty}>{t('flow.page.columnEmpty')}</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
