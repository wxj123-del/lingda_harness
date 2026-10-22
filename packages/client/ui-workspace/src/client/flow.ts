/**
 * Workspace flow derivation: one lifecycle stage per Session in a Workspace
 * plus the task-list figures the flow overview renders. Stages read live list
 * facts only — activity, pending human interaction, and the `todos` and
 * `turnOutline` projections — so the overview follows the same state the rows
 * already show and never needs to open a Session.
 */
import type {
  SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
// Type-only: pulls the `turnOutline` and `sessionStats` projection-key merges
// into this program and names their entry types.
import type { TurnOutlineEntry } from '@deepseek-ai/dsh-session-turn-outline/client'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { indexSubagentDescendants } from './subagent-lineage.ts'
import { visiblePendingKind, type SessionPendingInteractionStatus } from './tree.ts'

/**
 * Stage a Workspace Session occupies in the flow overview:
 * waiting (needs the user), working (live activity), progress (a started task
 * list still open), todo (work not started), done (settled).
 */
export type SessionFlowStage = 'waiting' | 'working' | 'progress' | 'todo' | 'done'

/** Overview column order: attention first, live and started work next, settled last. */
export const FLOW_STAGES: readonly SessionFlowStage[] = ['waiting', 'working', 'progress', 'todo', 'done']

/** One Session row inside a flow stage. */
export interface SessionFlowItem {
  id: SessionId
  /** Stored display title; blank rows render the localized New Session label. */
  title: string
  /** The provisional empty Session: no turn has started yet. */
  blank: boolean
  stage: SessionFlowStage
  /** Completed entries in the current task list; 0 without a list. */
  todoDone: number
  /** Total entries in the current task list; 0 without a list. */
  todoTotal: number
  /** The Session's current task list in model order; empty without one. */
  todos: readonly TodoItem[]
  /** Started turns, oldest first, with their bounded prompt and response previews. */
  turns: readonly TurnOutlineEntry[]
  /** Whole-log turn and step figures, absent until the projection checkpoint lands. */
  stats: SessionStatsProjection | undefined
  updatedAt: number
}

/** One flow stage with its Sessions newest first. */
export interface SessionFlowGroup {
  stage: SessionFlowStage
  items: readonly SessionFlowItem[]
}

type FlowProjections = SessionSummary['projectionValues']

/**
 * Classify one Session from the same facts its row uses.
 *
 * A task list outranks history because it states the work explicitly: an open
 * entry means not done, and an in-progress entry means started. Without a list,
 * `turnOutline` separates a Session that never ran a turn (still to do) from one
 * whose last turn ended (done); both in-progress and done are durable while the
 * live running bit owns everything in flight.
 */
function stageOf(
  summary: SessionSummary,
  pendingKind: SessionPendingInteractionStatus | undefined,
  runningDescendants: number,
  projections: FlowProjections,
): SessionFlowStage {
  if (pendingKind !== undefined) return 'waiting'
  if (summary.running || runningDescendants > 0) return 'working'
  if (summary.blank) return 'todo'
  const todos = projections?.todos
  if (todos !== null && todos !== undefined && todos.length > 0) {
    if (todos.some(item => item.status === 'in_progress')) return 'progress'
    if (todos.every(item => item.status === 'completed')) return 'done'
    return 'todo'
  }
  // An empty outline is a Session that has not started a turn yet. Unknown
  // outline (a cold row without a projection checkpoint) falls through to the
  // settled stage rather than claiming work is pending.
  if (projections?.turnOutline !== undefined && projections.turnOutline.length === 0) return 'todo'
  return 'done'
}

/** Completed task entries with their list size, or zeros when no list exists. */
function taskFigures(todos: readonly TodoItem[] | null | undefined): { done: number; total: number } {
  if (todos === null || todos === undefined) return { done: 0, total: 0 }
  return { done: todos.filter(item => item.status === 'completed').length, total: todos.length }
}

/** Newest first with the Session id as a deterministic tie-break. */
function byRecency(a: SessionFlowItem, b: SessionFlowItem): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Derive the flow overview for one Workspace.
 *
 * Every non-archived ordinary member with a loaded summary appears exactly
 * once. Blank Sessions count as not-started work, and subagent-origin rows stay
 * out because the browser never lists them.
 * @param list - sessions list snapshot.
 * @param workspace - Workspace with caller-projected member order.
 * @param archivedSessionIds - registry-global archive set.
 * @param pendingInteractions - pending UI interactions by Session.
 * @returns stage groups in display order, each newest first.
 */
export function deriveWorkspaceFlow(
  list: SessionListState,
  workspace: WorkspaceView,
  archivedSessionIds: readonly SessionId[],
  pendingInteractions: ReadonlyMap<SessionId, SessionPendingInteractionBase>,
): SessionFlowGroup[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const items: SessionFlowItem[] = []
  for (const id of workspace.sessionIds) {
    const summary = list.byId[id]
    if (summary === undefined || archived.has(id) || summary.origin === 'subagent') continue
    const projections = summary.projectionValues
    const todos = projections?.todos
    const pendingStage = visiblePendingKind(pendingInteractions.get(id)?.kind)
    const runningDescendants = descendants.get(id)?.runningCount ?? 0
    const { done, total } = taskFigures(todos)
    items.push({
      id,
      title: summary.displayTitle,
      blank: summary.blank,
      stage: stageOf(summary, pendingStage, runningDescendants, projections),
      todoDone: done,
      todoTotal: total,
      todos: todos ?? [],
      turns: projections?.turnOutline ?? [],
      stats: projections?.sessionStats,
      updatedAt: summary.updatedAt,
    })
  }
  return FLOW_STAGES.map(stage => ({
    stage,
    items: items.filter(item => item.stage === stage).sort(byRecency),
  }))
}
