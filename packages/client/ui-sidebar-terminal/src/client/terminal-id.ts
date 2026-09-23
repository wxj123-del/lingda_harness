/** Stable Host identity reserved for the Conversation terminal of one Session. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WebTerminalId } from '@deepseek-ai/dsh-api-terminal-controller/types'

/**
 * Derive the one deterministic terminal identity owned by a Session's
 * Conversation View. Stable ids let a page reload reconnect the dedicated
 * terminal instead of recovering it as an unrelated Sidebar tab.
 * @param sessionId - owning Session identity.
 * @returns the reserved Host terminal identity.
 */
export function conversationTerminalId(sessionId: SessionId): WebTerminalId {
  return `conversation-${sessionId}` as WebTerminalId
}
