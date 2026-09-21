import { useEffect, useMemo, useState } from 'react'
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14,
  IconDatabaseOutline16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  KnowledgeBase,
  KnowledgeOverview,
} from '@deepseek-ai/dsh-api-remotes/client'
import css from './KnowledgeConversationControl.module.css'

type Id = KnowledgeBase['id']
type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message?: string; code?: string } }

export interface KnowledgeConversationControlInjected {
  overview: () => Promise<RemoteResult<KnowledgeOverview>>
  selected: (sessionId: string) => Promise<RemoteResult<Id[]>>
  setSelected: (sessionId: string, baseIds: Id[]) => Promise<RemoteResult<{ sessionId: string; baseIds: Id[] }>>
  openManagement: () => void
}

export type KnowledgeConversationControlProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<KnowledgeConversationControlInjected>
  & PropsLocale<'layout'>

function errorMessage(result: { message?: string; code?: string }, fallback: string): string {
  return result.message ?? result.code ?? fallback
}

/** Composer affordance for selecting the knowledge bases used by this Session. */
export function KnowledgeConversationControl({
  t, overview: readOverview, selected: readSelected, setSelected, openManagement, sessionId,
}: KnowledgeConversationControlProps) {
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    // The base list is independent of this Session's selection: publish it as
    // soon as it arrives so a failing selection read cannot strand the menu in
    // its loading state with no usable entries.
    const overviewResult = await readOverview()
    if (!overviewResult.ok) {
      setError(errorMessage(overviewResult.error, t('kb.operationError')))
      return
    }
    setOverview(overviewResult.value)
    let selectedResult: RemoteResult<Id[]>
    try {
      selectedResult = await readSelected(sessionId)
    } catch (cause) {
      setSelectedIds([])
      setError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    if (!selectedResult.ok) {
      setSelectedIds([])
      setError(errorMessage(selectedResult.error, t('kb.operationError')))
      return
    }
    setSelectedIds(selectedResult.value.filter(id => overviewResult.value.bases.some(
      base => base.id === id && base.enabled,
    )))
    setError(null)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const [selectedIds, setSelectedIds] = useState<Id[]>([])
  const selectedBases = useMemo(
    () => overview?.bases.filter(base => selectedIds.includes(base.id)) ?? [],
    [overview, selectedIds],
  )
  const items: readonly MenuEntry[] = overview === null
    ? [{ type: 'label', id: 'loading', text: t('kb.chat.loading') }]
    : overview.bases.length === 0
      ? [{ type: 'label', id: 'empty', text: t('kb.chat.empty') }]
      : [
        { type: 'label', id: 'bases', text: t('kb.chat.choose') },
        ...overview.bases.map(base => ({
          id: base.id,
          label: <span title={base.title}>{base.title}</span>,
          disabled: busyId !== null || !base.enabled,
        })),
      ]
  const footer: readonly MenuEntry[] = [
    { type: 'separator', id: 'divider' },
    { id: 'manage', label: t('kb.chat.manage') },
  ]

  const toggle = (id: string): void => {
    if (id === 'manage') {
      setOpen(false)
      openManagement()
      return
    }
    if (overview === null || busyId !== null) return
    const next = selectedIds.includes(id as Id)
      ? selectedIds.filter(candidate => candidate !== id)
      : [...selectedIds, id as Id]
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        const result = await setSelected(sessionId, next)
        if (!result.ok) throw new Error(errorMessage(result.error, t('kb.operationError')))
        setSelectedIds(result.value.baseIds)
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusyId(null)
      }
    })()
  }

  const label = selectedBases.length === 0 ? t('kb.chat.enable') : t('kb.chat.label')
  const title = error ?? (selectedBases.length === 0
    ? t('kb.chat.enableTitle')
    : selectedBases.map(base => base.title).join('、'))

  return (
    <span className={css.wrap} title={title}>
      <Menu
        open={open}
        items={items}
        footer={footer}
        selectedIds={selectedIds}
        selection="check"
        onSelect={toggle}
        onClose={() => { setOpen(false) }}
        side="top"
        portal
        anchor={(
          <button
            type="button"
            className={`${css.trigger} ${selectedBases.length > 0 ? css.active : ''}`}
            aria-label={label}
            aria-pressed={selectedBases.length > 0}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              if (!open) void refresh()
              setOpen(!open)
            }}
          >
            <span className={css.icon} aria-hidden><IconDatabaseOutline16 size={14} /></span>
            <span className={css.label}>{label}</span>
            {selectedBases.length > 0 && <span className={css.count}>{selectedBases.length}</span>}
            <span className={css.chevron} aria-hidden><IconChevronDownOutline14 /></span>
          </button>
        )}
      />
    </span>
  )
}
