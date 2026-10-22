/** Shared chat surface for drafting a workflow or a knowledge base from a conversation. */
import { useState, type ReactNode } from 'react'
import { Button, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthoringChatTurn } from '@deepseek-ai/dsh-api-remotes/client'
import type { LayoutKey } from '../locales.ts'
import css from './AuthoringChat.module.css'

/** One rendered chat message plus an optional apply affordance per draft answer. */
export interface AuthoringChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Set when this assistant turn produced a usable draft. */
  draftReady?: boolean
  /** Fetch outcomes shown under a knowledge draft reply. */
  sources?: ReadonlyArray<{ url: string; status: 'ok' | 'failed'; detail?: string }>
}

export interface AuthoringChatProps {
  title: string
  intro: string
  placeholder: string
  messages: readonly AuthoringChatMessage[]
  busy: boolean
  error: string | null
  /** Extra controls rendered above the composer (source URLs, draft notice). */
  accessory?: ReactNode
  onSend: (text: string) => void
  onApply: (messageId: string) => void
  onClose: () => void
  t: (key: LayoutKey) => string
}

/** Render the draft-chat transcript with its composer and per-message apply action. */
export function AuthoringChat({
  title, intro, placeholder, messages, busy, error, accessory, onSend, onApply, onClose, t,
}: AuthoringChatProps) {
  const [draft, setDraft] = useState('')
  const send = () => {
    const text = draft.trim()
    if (text === '' || busy) return
    setDraft('')
    onSend(text)
  }
  return <main className={css.page}>
    <div className={css.inner}>
      <header className={css.header}>
        <div className={css.heading}>
          <IconNewChatOutline16 size={24} />
          <div><h1>{title}</h1><p>{intro}</p></div>
        </div>
        <Button variant="outline" onClick={onClose}>{t('chat.close')}</Button>
      </header>
      <div className={css.transcript} role="log" aria-live="polite">
        {messages.map(message => <div key={message.id} className={message.role === 'user' ? css.user : css.assistant}>
          <p className={css.messageText}>{message.text}</p>
          {message.sources !== undefined && message.sources.length > 0 && <ul className={css.sources}>
            {message.sources.map(source => <li key={source.url} data-state={source.status}>
              <span>{source.url}</span>{source.status === 'failed' ? ` — ${source.detail ?? t('chat.sourceFailed')}` : ''}
            </li>)}
          </ul>}
          {message.draftReady === true && <Button size="sm" variant="primary" onClick={() => { onApply(message.id) }}>{t('chat.apply')}</Button>}
        </div>)}
        {busy && <p className={css.busy}>{t('chat.generating')}</p>}
      </div>
      {error !== null && <p role="alert" className={css.error}>{error}</p>}
      <div className={css.composer}>
        {accessory}
        <textarea
          className={css.input}
          value={draft}
          placeholder={placeholder}
          rows={3}
          disabled={busy}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className={css.actions}>
          <span className={css.hint}>{t('chat.sendHint')}</span>
          <Button variant="primary" disabled={busy || draft.trim() === ''} onClick={send}>{t('chat.send')}</Button>
        </div>
      </div>
    </div>
  </main>
}

/**
 * Project the transcript into the turn list the Host accepts.
 * @param messages - current transcript.
 * @returns user and assistant turns, oldest first.
 */
export function chatHistory(messages: readonly AuthoringChatMessage[]): AuthoringChatTurn[] {
  return messages.map(message => ({ role: message.role, text: message.text }))
}
