import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconSettingsOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './KnowledgeConversationControl.module.css'

type Mode = 'qa' | 'research' | 'coding' | 'execution'
interface ModeOption { value: Mode; name: string; description: string; maxSteps: number; maxContextTokens: number }
interface ModeView { mode: Mode; policy: { maxSteps: number; maxContextTokens: number } }
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message?: string; code?: string } }

export interface PersonalModeConversationControlInjected {
  current: (sessionId: string) => Promise<RemoteResult<ModeView>>
  modes: () => Promise<RemoteResult<ModeOption[]>>
  set: (sessionId: string, mode: Mode) => Promise<RemoteResult<ModeView>>
  suggest: (input: string) => Promise<RemoteResult<{ mode: Mode | null }>>
}

export type PersonalModeConversationControlProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<PersonalModeConversationControlInjected>
  & PropsLocale<'layout'>

const fallbackNames: Record<Mode, string> = {
  qa: '问答', research: '研究', coding: '编码', execution: '执行 / 媒体',
}

/** Current personal Agent mode and its bounded tool budget. */
export function PersonalModeConversationControl({
  sessionId, draft, current: readCurrent, modes: readModes, set: setMode, suggest: suggestMode, t,
}: PersonalModeConversationControlProps) {
  const [view, setView] = useState<ModeView | null>(null)
  const [options, setOptions] = useState<ModeOption[]>([])
  const [suggestion, setSuggestion] = useState<Mode | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    // A rejected read must still leave the menu describing a real state: the
    // catalog is what the menu lists, so publish it before the mode read and
    // never resolve `loaded` without either options or a visible error.
    try {
      const catalog = await readModes()
      if (catalog.ok) setOptions(catalog.value)
      else setError(catalog.error.message ?? catalog.error.code ?? t('mode.catalogError'))
      const current = await readCurrent(sessionId)
      if (current.ok) setView(current.value)
      else setError(current.error.message ?? current.error.code ?? t('mode.readError'))
      if (catalog.ok && current.ok) setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => { void refresh() }, [sessionId])

  // Suggestions are local-rule results from the host and never invoke a model.
  useEffect(() => {
    let live = true
    const text = draft.trim()
    if (text === '') {
      setSuggestion(null)
      return () => { live = false }
    }
    const timer = window.setTimeout(() => {
      void suggestMode(text).then((result) => {
        if (!live || !result.ok) return
        const next = result.value.mode
        setSuggestion(next !== null && next !== (view?.mode ?? 'qa') ? next : null)
      }).catch(() => {
        if (live) setSuggestion(null)
      })
    }, 180)
    return () => { live = false; window.clearTimeout(timer) }
  }, [draft, suggestMode, view?.mode])

  const current = view?.mode ?? 'qa'
  const option = options.find(item => item.value === current)
  const items: readonly MenuEntry[] = options.length === 0
    ? [{ type: 'label', id: loaded ? 'empty' : 'loading', text: loaded ? t('mode.catalogEmpty') : t('mode.loading') }]
    : options.map(item => ({ id: item.value, label: item.name, description: item.description }))
  const choose = (value: string): void => {
    if (!options.some(item => item.value === value) || value === current || busy) {
      setOpen(false)
      return
    }
    setOpen(false)
    setBusy(true)
    void setMode(sessionId, value as Mode)
      .then((result) => {
        if (!result.ok) throw new Error(result.error.message ?? result.error.code ?? t('mode.switchError'))
        setView(result.value)
      })
      .catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }

  const label = option?.name ?? fallbackNames[current]
  const title = error ?? t('mode.policyTitle', {
    description: option?.description ?? '',
    maxSteps: view?.policy.maxSteps ?? 0,
    maxContextTokens: view?.policy.maxContextTokens ?? 0,
  })
  return (
    <span className={css.wrap} title={title}>
      {suggestion !== null && <button
        type="button"
        className={css.suggestion}
        title={t('mode.suggestionTitle', { name: fallbackNames[suggestion] })}
        onClick={() => {
          setBusy(true)
          void setMode(sessionId, suggestion)
            .then((result) => {
              if (!result.ok) throw new Error(result.error.message ?? result.error.code ?? t('mode.switchError'))
              setView(result.value)
              setSuggestion(null)
            })
            .catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)) })
            .finally(() => { setBusy(false) })
        }}
      >{t('mode.suggestion', { name: fallbackNames[suggestion] })}</button>}
      <Menu
        open={open}
        items={items}
        selectedId={current}
        onSelect={choose}
        onClose={() => { setOpen(false) }}
        side="top"
        portal
        anchor={(
          <button
            type="button"
            className={`${css.trigger} ${css.active}`}
            aria-label={t('mode.current', { name: label })}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={busy}
            onClick={() => { if (!open) void refresh(); setOpen(!open) }}
          >
            <span className={css.icon} aria-hidden><IconSettingsOutline16 size={14} /></span>
            <span className={css.label}>{label}</span>
            <span className={css.count}>{view?.policy.maxSteps ?? 0}</span>
            <span className={css.chevron} aria-hidden><IconChevronDownOutline14 /></span>
          </button>
        )}
      />
    </span>
  )
}
