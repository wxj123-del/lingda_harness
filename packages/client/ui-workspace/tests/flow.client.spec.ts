import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionBase } from '@deepseek-ai/dsh-client-ui-session/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import type { TurnOutlineEntry } from '@deepseek-ai/dsh-session-turn-outline/client'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveWorkspaceFlow, FLOW_STAGES } from '../src/client/flow.ts'

const sid = (id: string) => id as SessionId
const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...overrides,
})
const list = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const workspace = (sessionIds: string[]): WorkspaceView => ({
  workspaceId: 'project' as WorkspaceId, path: '/projects/project', title: 'Project',
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
const todos = (...statuses: TodoItem['status'][]): TodoItem[] =>
  statuses.map((status, index) => ({ content: `task ${index}`, status }))
const turn = (id: string): TurnOutlineEntry => ({
  turn: 0, seq: SessionSeq(1), prompt: id, response: 'done',
})
const noPending: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map()
const noArchive: readonly SessionId[] = []

/** Collapse the stage groups into "stage: ids" for compact assertions. */
function layout(groups: ReturnType<typeof deriveWorkspaceFlow>): string[] {
  return groups.map(group => `${group.stage}:${group.items.map(item => item.id).join(',')}`)
}

describe('deriveWorkspaceFlow', () => {
  it('keeps the fixed stage order and drops empty stages to empty groups', () => {
    const groups = deriveWorkspaceFlow(list(), workspace([]), noArchive, noPending)
    expect(groups.map(group => group.stage)).toEqual(FLOW_STAGES)
    expect(groups.every(group => group.items.length === 0)).toBe(true)
  })

  it('classifies waiting, working, in-progress, todo, and done sessions', () => {
    const sessions = list(
      summary('asking', 50, { running: true }),
      summary('running', 40, { running: true }),
      summary('started', 30, { projectionValues: { todos: todos('completed', 'in_progress', 'pending') } }),
      summary('planned', 20, { projectionValues: { todos: todos('pending', 'pending') } }),
      summary('settled', 10, { projectionValues: { turnOutline: [turn('settled')] } }),
    )
    const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
      sid('asking'), { key: 'question:1', kind: 'question', sessionId: sid('asking') },
    ]])
    const groups = deriveWorkspaceFlow(
      sessions,
      workspace(['asking', 'running', 'started', 'planned', 'settled']),
      noArchive,
      attention,
    )
    expect(layout(groups)).toEqual([
      'waiting:asking',
      'working:running',
      'progress:started',
      'todo:planned',
      'done:settled',
    ])
  })

  it('treats a blank session as not-started work and reports no task figures', () => {
    const groups = deriveWorkspaceFlow(list(summary('fresh', 5, { blank: true })), workspace(['fresh']), noArchive, noPending)
    expect(layout(groups)).toEqual(['waiting:', 'working:', 'progress:', 'todo:fresh', 'done:'])
    expect(groups[3]!.items[0]).toMatchObject({ todoDone: 0, todoTotal: 0, blank: true })
  })

  it('counts live descendant activity as working for an idle parent', () => {
    const sessions = list(
      summary('parent', 5),
      summary('child', 6, { parentId: sid('parent'), origin: 'subagent', running: true }),
    )
    const groups = deriveWorkspaceFlow(sessions, workspace(['parent']), noArchive, noPending)
    expect(layout(groups)).toContain('working:parent')
  })

  it('reports finished task figures and orders each stage newest first', () => {
    const sessions = list(
      summary('older', 10, { projectionValues: { todos: todos('completed', 'pending') } }),
      summary('newer', 20, { projectionValues: { todos: todos('completed', 'pending') } }),
      summary('complete', 30, { projectionValues: { todos: todos('completed', 'completed') } }),
    )
    const groups = deriveWorkspaceFlow(
      sessions, workspace(['older', 'newer', 'complete']), noArchive, noPending,
    )
    expect(layout(groups)).toContain('todo:newer,older')
    expect(layout(groups)).toContain('done:complete')
    const planned = groups.find(group => group.stage === 'todo')!.items[0]!
    expect(planned).toMatchObject({ todoDone: 1, todoTotal: 2 })
  })

  it('breaks equal timestamps by Session id regardless of arrival order', () => {
    const sessions = list(
      summary('beta', 10, { projectionValues: { turnOutline: [] } }),
      summary('alpha', 10, { projectionValues: { turnOutline: [] } }),
    )
    expect(layout(deriveWorkspaceFlow(sessions, workspace(['beta', 'alpha']), noArchive, noPending)))
      .toContain('todo:alpha,beta')
    expect(layout(deriveWorkspaceFlow(sessions, workspace(['alpha', 'beta']), noArchive, noPending)))
      .toContain('todo:alpha,beta')
  })

  it('separates a never-started Session from a settled one by its turn outline', () => {
    const sessions = list(
      summary('never-started', 20, { projectionValues: { turnOutline: [] } }),
      summary('ran-a-turn', 10, { projectionValues: { turnOutline: [turn('ran-a-turn')] } }),
    )
    const groups = deriveWorkspaceFlow(
      sessions, workspace(['never-started', 'ran-a-turn']), noArchive, noPending,
    )
    expect(layout(groups)).toEqual(['waiting:', 'working:', 'progress:', 'todo:never-started', 'done:ran-a-turn'])
  })

  it('omits archived sessions, subagent-origin rows, and unknown members', () => {
    const sessions = list(
      summary('kept', 10),
      summary('archived', 20),
      summary('child', 30, { parentId: sid('kept'), origin: 'subagent' }),
    )
    const groups = deriveWorkspaceFlow(
      sessions, workspace(['kept', 'archived', 'child', 'missing']), [sid('archived')], noPending,
    )
    expect(layout(groups)).toEqual(['waiting:', 'working:', 'progress:', 'todo:', 'done:kept'])
  })

  it('keeps pending approval ahead of live activity as waiting', () => {
    const sessions = list(summary('approval', 10, { running: true }))
    const attention: ReadonlyMap<SessionId, SessionPendingInteractionBase> = new Map([[
      sid('approval'), { key: 'approval:1', kind: 'approval', sessionId: sid('approval') },
    ]])
    const groups = deriveWorkspaceFlow(sessions, workspace(['approval']), noArchive, attention)
    expect(layout(groups)).toContain('waiting:approval')
  })
})
