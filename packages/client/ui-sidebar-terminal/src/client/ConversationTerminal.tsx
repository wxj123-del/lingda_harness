/** Session-local interactive terminal rendered as a Conversation View tab. */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { ConversationTerminalInjected } from './face.ts'
import type {} from './locales.ts'
import { TerminalScreen } from './TerminalBody.tsx'
import { conversationTerminalId } from './terminal-id.ts'
import css from './TerminalBody.module.css'

/** Full props for the session-local Conversation terminal. */
export type ConversationTerminalProps = ConvViewProps & PropsLocale<'sidebarTerminal'> & InjectFace<ConversationTerminalInjected>

/**
 * Render the terminal that belongs to the current Session.
 *
 * The model is keyed by Session and kept by the Client terminal controller,
 * so switching Conversation Views detaches the stream without sharing a PTY
 * with another Session.
 *
 * @param props - Conversation View runtime, terminal model, theme and copy.
 * @returns the terminal status and xterm screen.
 */
export { conversationTerminalId }

export function ConversationTerminal({ terminal, useTheme, t }: ConversationTerminalProps): ReactNode {
  const state = useSyncExternalStore(
    listener => terminal.state.subscribe(listener),
    () => terminal.state.getSnapshot(),
    () => terminal.state.getSnapshot(),
  )
  const theme = useTheme(value => value)

  useEffect(() => terminal.mount(), [terminal])

  const error = state.issue === undefined ? state.error ?? state.info?.error : t(state.issue)
  const status = terminalStatus(state, t)
  const retry = state.phase === 'failed' || state.phase === 'disconnected'
  const readOnly = state.phase === 'connected' && state.info?.state === 'running' && !state.writable

  return (
    <section className={css.root} data-conversation-terminal>
      {(status !== undefined || retry || readOnly) && <div className={css.status} role="status">
        {status}
        {readOnly && <>{t('readonly')} <button type="button" onClick={() => { terminal.connect() }}>{t('control')}</button></>}
        {retry && (state.info === undefined
          ? <button type="button" onClick={() => { void terminal.refresh() }}>{t('retry')}</button>
          : <button type="button" onClick={() => { terminal.connect() }}>{t('reconnect')}</button>)}
      </div>}
      {state.info !== undefined && <TerminalScreen state={state} model={terminal} visible label={t('title')} theme={theme} />}
      {error !== undefined && <p className={css.error} role="alert">{t('failed', { message: error })}</p>}
    </section>
  )
}

function terminalStatus(state: TerminalViewState, t: ConversationTerminalProps['t']): string | undefined {
  if (state.phase === 'idle' || state.phase === 'loading') return t('loading')
  if (state.phase === 'creating' || state.phase === 'connecting' || state.phase === 'disconnected') return t(state.phase)
  if (state.info?.state === 'exited') return t('exited', { code: String(state.info.exitCode ?? '—') })
  if (state.info?.state === 'failed') return t('unavailable')
  if (state.phase === 'closed') return t('closed')
  return undefined
}
