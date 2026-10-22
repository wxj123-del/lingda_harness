/** Chat-owned per-Session view state. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** One explicitly opened or closed Turn process generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly answerStep: number | null
  readonly open: boolean
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  turnProcesses: TurnProcessViewEntry[]
}
