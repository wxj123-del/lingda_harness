/**
 * Desktop pet state: the one summary the pet window shows.
 *
 * The pet never talks to the Host itself. The Electron main process polls the
 * Session list through the desktop host's own `/api` carrier, folds the answer
 * into this shape, and pushes it to the pet window. Keeping the fold here (pure,
 * no Electron import) lets the mapping — which Session counts, what "done"
 * means, how a missing projection degrades — be tested without a display.
 */

/** One Screen-reader-free task tally the pet draws. */
export interface DesktopPetTask {
  /** Session title, when the title projection is cached. */
  readonly title?: string
  /** Completed todo entries. */
  readonly done: number
  /** Total todo entries in the latest `todo/write` snapshot. */
  readonly total: number
  /** Text of the first in-progress entry, when the list is non-empty. */
  readonly current?: string
}

/** Pet phase; the main process times the short `done` celebration. */
export type DesktopPetPhase = 'idle' | 'working' | 'done'

/** Everything the pet window renders. */
export interface DesktopPetState {
  readonly phase: DesktopPetPhase
  /** Running, non-blank Sessions behind this summary. */
  readonly running: number
  /** Task tally of the Session the pet follows, when it has a todo list. */
  readonly task?: DesktopPetTask
}

/** The RPC reply envelope the desktop host answers `/api/session/list` with. */
interface SessionListReply {
  readonly result?: {
    readonly ok?: boolean
    readonly value?: { readonly items?: readonly SessionSummary[] }
  }
}

/** The subset of a Session summary this fold reads. */
interface SessionSummary {
  readonly sessionId?: string
  readonly updatedAt?: number
  readonly running?: boolean
  readonly blank?: boolean
  readonly projections?: {
    readonly values?: {
      readonly title?: string | null
      readonly todos?: readonly TodoEntry[] | null
    }
  }
}

/** One `todo/write` entry. */
interface TodoEntry {
  readonly content?: string
  readonly status?: 'pending' | 'in_progress' | 'completed'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether a Session summary describes work the pet should follow. */
function isRunning(summary: SessionSummary): boolean {
  return summary.running === true && summary.blank !== true
}

/**
 * Tally one Session's todo projection.
 * @param summary - Session summary carrying optional projections.
 * @returns the tally, or undefined when the Session has no todo list.
 */
function taskOf(summary: SessionSummary): DesktopPetTask | undefined {
  const todos = summary.projections?.values?.todos
  if (!Array.isArray(todos) || todos.length === 0) return undefined
  let done = 0
  let current: string | undefined
  for (const entry of todos) {
    if (!isRecord(entry)) continue
    const todo = entry as TodoEntry
    if (todo.status === 'completed') done += 1
    else if (current === undefined && todo.status === 'in_progress'
      && typeof todo.content === 'string' && todo.content !== '') current = todo.content
  }
  const title = summary.projections?.values?.title
  return {
    done,
    total: todos.length,
    ...(typeof title === 'string' && title !== '' ? { title } : {}),
    ...(current === undefined ? {} : { current }),
  }
}

/**
 * Fold one `/api/session/list` reply into the pet's summary.
 *
 * A running Session that carries a todo list wins (most recently updated
 * first); a running Session without one still counts as work, so the pet
 * animates even when the agent has not written todos.
 * @param payload - parsed reply envelope, or an RPC failure.
 * @returns the summary to render; `idle` when nothing is running.
 */
export function resolvePetState(payload: unknown): DesktopPetState {
  const reply = isRecord(payload) ? payload as SessionListReply : {}
  const items = reply.result?.ok === true ? reply.result.value?.items : undefined
  if (!Array.isArray(items)) return { phase: 'idle', running: 0 }
  const running = items.filter(item => isRecord(item) && isRunning(item as SessionSummary)) as SessionSummary[]
  if (running.length === 0) return { phase: 'idle', running: 0 }
  const ordered = [...running].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
  const followed = ordered.find(entry => taskOf(entry) !== undefined) ?? ordered[0]
  const task = followed === undefined ? undefined : taskOf(followed)
  return {
    phase: 'working',
    running: running.length,
    ...(task === undefined ? {} : { task }),
  }
}

/**
 * Build the request the desktop host's `/api/session/list` carrier expects.
 * @param rpcId - correlation id echoed by the reply.
 * @returns a JSON string body for the request.
 */
export function sessionListRequestBody(rpcId: string): string {
  return JSON.stringify({
    type: 'client-request',
    rpcId,
    method: 'session/list',
    payload: { args: { _request: {} } },
  })
}
