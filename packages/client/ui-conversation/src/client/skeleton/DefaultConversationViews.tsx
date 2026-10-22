import { useEffect } from 'react'
import type { ConversationSessionSlotProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function DefaultConversationViews({
  useSession, useConversation, useConversationViews, useShowViewTabs, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView,
}: ConversationSessionSlotProps) {
  const tabs = useConversationViews(value => value)
  const showViewTabs = useShowViewTabs(value => value)
  const selectedId = useStore(s => s.view)
  // Hiding the switcher also means showing Chat. The stored selection outlives
  // the setting, so resolving it here would park a Session on another View
  // whose only control for leaving is the switcher that was just turned off.
  const active = resolveActiveView(tabs, showViewTabs ? selectedId : null)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  if (session.blank && conversationPhase(session, conversation) === 'blank') return null
  return (
    <div className={css.viewArea}>
      {active !== undefined && renderSlot('conversation.view', {
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: active.id })}
    </div>
  )
}
