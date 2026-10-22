/**
 * Pure types of the task domain: the ONE home of the `task` projection-key
 * declaration plus the durable snapshot it carries. Free of host-side value
 * imports so a client aggregate can consume the same declarations.
 * @module @deepseek-ai/dsh-task-state/types
 */

/** What kind of artifact one evidence record points at. */
export type TaskEvidenceKind = 'command' | 'test' | 'file' | 'manual'

/** Whether one evidence record demonstrates the behavior it names. */
export type TaskEvidenceStatus = 'pass' | 'fail' | 'unknown'

/** One verifiable fact recorded against a task. */
export interface TaskEvidence {
  /** Stable id unique within the task snapshot. */
  id: string
  kind: TaskEvidenceKind
  /** Command line, path, or short description naming exactly what was run or read. */
  ref: string
  status: TaskEvidenceStatus
  /**
   * 1-based indices into {@link TaskState.acceptance} this record covers.
   * Empty means the record is retained but covers no acceptance criterion.
   */
  acceptance: number[]
  /** Epoch milliseconds when the record was taken. */
  at: number
  /** True when a tool-result observer recorded it without a model call. */
  auto?: true | undefined
}

/** One durable decision with its rationale, retained across compaction. */
export interface TaskDecision {
  text: string
  at: number
}

/** Durable lifecycle phase of one task. */
export type TaskStatus = 'active' | 'blocked' | 'succeeded' | 'cancelled'

/**
 * The complete task snapshot carried by one `task/state` event. Every mutation
 * writes a whole snapshot, so replay is last-write-wins and a consumer never
 * merges partial updates.
 */
export interface TaskState {
  /** Monotonic revision; every durable mutation increments it. */
  revision: number
  /** The user objective in their own terms. */
  objective: string
  status: TaskStatus
  /**
   * Acceptance criteria in declaration order. An item's 1-based position is the
   * index evidence uses to claim coverage.
   */
  acceptance: string[]
  /** Evidence records in the order they were taken. */
  evidence: TaskEvidence[]
  /** Decisions and their rationale, retained through compaction. */
  decisions: TaskDecision[]
  /** One paragraph describing where to resume after a budget stop or resume. */
  handoff?: string | undefined
  createdAt: number
  updatedAt: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete post-mutation task snapshot; latest write wins on replay. */
    'task/state': { task: TaskState | null }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    task: TaskState | null
  }
  interface SessionProjectionMap {
    /**
     * The session's current task snapshot, or `null` before the first write and
     * after an explicit clear. Whole-value rule: every event carries the
     * complete replacement, so the fold is last-wins.
     */
    task: TaskState | null
  }
}
