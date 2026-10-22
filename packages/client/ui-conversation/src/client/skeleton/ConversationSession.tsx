/** Strict per-session header/body content inserted into the resident conversation layout. */

import clsx from 'clsx'
import { useState } from 'react'
import { IconEllipsisOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { INLINE_VIEW_LIMIT, resolveActiveView, splitViewTabs } from '../view-selection.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * The Session's View switcher: the first few Views as header tabs plus one
 * overflow menu for the rest, so a Session with many registered Views keeps a
 * single-row header. The active View always keeps a visible tab of its own.
 * @param props.tabs - registered Views in slot order.
 * @param props.activeId - the resolved active View's id.
 * @param props.onSelect - select one View by id.
 * @param props.t - the Conversation locale seat.
 * @returns the tab list and, when needed, its overflow menu.
 */
function ViewTabs({ tabs, activeId, onSelect, t }: {
  tabs: readonly ViewTab[]
  activeId: string | undefined
  onSelect: (id: string) => void
  t: ConversationSessionHeaderProps['t']
}) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const { inline, overflow } = splitViewTabs(tabs, activeId, INLINE_VIEW_LIMIT)
  return (
    <div className={css.tabs}>
      <div className={css.tablist} role="tablist">
        {inline.map(viewTab => (
          <button
            key={viewTab.id}
            type="button"
            role="tab"
            aria-selected={viewTab.id === activeId}
            className={clsx(css.tab, viewTab.id === activeId && css.tabActive)}
            onClick={() => { onSelect(viewTab.id) }}
          >
            {viewTab.label}
          </button>
        ))}
      </div>
      {overflow.length > 0 && (
        <Menu
          open={overflowOpen}
          onClose={() => { setOverflowOpen(false) }}
          items={overflow.map(viewTab => ({ id: viewTab.id, label: viewTab.label }))}
          selectedIds={activeId === undefined ? [] : [activeId]}
          onSelect={(id) => {
            setOverflowOpen(false)
            onSelect(id)
          }}
          align="end"
          dense
          portal
          anchor={(
            <button
              type="button"
              className={clsx(css.tab, css.overflowTab)}
              aria-label={t('view.more')}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              onClick={() => { setOverflowOpen(open => !open) }}
            >
              <IconEllipsisOutline16 size={14} />
            </button>
          )}
        />
      )}
    </div>
  )
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useShowViewTabs, useStore,
  renderSlot, open, selectView, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const showViewTabs = useShowViewTabs(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const hideChrome = session.blank && conversationPhase(session, conversation) === 'blank'

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
            <div className={css.headerCorner} data-conversation-header-corner="">
              {renderSlot('conversation.session.header.corner', {})}
            </div>
          </div>
          {showViewTabs && tabs.length > 1 && (
            <ViewTabs
              tabs={tabs}
              activeId={active?.id}
              onSelect={selectView}
              t={t}
            />
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}
