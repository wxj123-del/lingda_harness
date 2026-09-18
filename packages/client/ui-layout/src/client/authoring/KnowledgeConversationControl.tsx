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
  KnowledgeBaseDraft,
} from '@deepseek-ai/dsh-api-remotes/client'
import css from './KnowledgeConversationControl.module.css'

type Id = KnowledgeBase['id']
type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message?: string; code?: string } }

export interface KnowledgeConversationControlInjected {
  overview: () => Promise<RemoteResult<KnowledgeOverview>>
  get: (id: Id) => Promise<RemoteResult<KnowledgeBase>>
  save: (draft: KnowledgeBaseDraft) => Promise<RemoteResult<KnowledgeBase>>
  openManagement: () => void
}

export type KnowledgeConversationControlProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<KnowledgeConversationControlInjected>
  & PropsLocale<'layout'>

function errorMessage(result: { message?: string; code?: string }): string {
  return result.message ?? result.code ?? 'Knowledge base operation failed'
}

/** Composer affordance for turning the model-facing knowledge tools on or off. */
export function KnowledgeConversationControl({
  t, overview: readOverview, get, save, openManagement,
}: KnowledgeConversationControlProps) {
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const result = await readOverview()
    if (result.ok) {
      setOverview(result.value)
      setError(null)
    } else {
      setError(errorMessage(result.error))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const enabled = useMemo(
    () => overview?.bases.filter(base => base.enabled) ?? [],
    [overview],
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
          disabled: busyId !== null,
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
    const base = overview?.bases.find(candidate => candidate.id === id)
    if (base === undefined || busyId !== null) return
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        const current = await get(base.id)
        if (!current.ok) throw new Error(errorMessage(current.error))
        const draft: KnowledgeBaseDraft = {
          id: current.value.id,
          title: current.value.title,
          description: current.value.description,
          enabled: !current.value.enabled,
          split: current.value.split,
          documents: current.value.documents,
          revision: current.value.revision,
        }
        const result = await save(draft)
        if (!result.ok) throw new Error(errorMessage(result.error))
        await refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusyId(null)
      }
    })()
  }

  const label = enabled.length === 0 ? t('kb.chat.enable') : t('kb.chat.label')
  const title = error ?? (enabled.length === 0
    ? t('kb.chat.enableTitle')
    : enabled.map(base => base.title).join('、'))

  return (
    <span className={css.wrap} title={title}>
      <Menu
        open={open}
        items={items}
        footer={footer}
        selectedIds={enabled.map(base => base.id)}
        selection="check"
        onSelect={toggle}
        onClose={() => { setOpen(false) }}
        side="top"
        portal
        anchor={(
          <button
            type="button"
            className={`${css.trigger} ${enabled.length > 0 ? css.active : ''}`}
            aria-label={label}
            aria-pressed={enabled.length > 0}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              if (!open) void refresh()
              setOpen(!open)
            }}
          >
            <span className={css.icon} aria-hidden><IconDatabaseOutline16 size={14} /></span>
            <span className={css.label}>{label}</span>
            {enabled.length > 0 && <span className={css.count}>{enabled.length}</span>}
            <span className={css.chevron} aria-hidden><IconChevronDownOutline14 /></span>
          </button>
        )}
      />
    </span>
  )
}
