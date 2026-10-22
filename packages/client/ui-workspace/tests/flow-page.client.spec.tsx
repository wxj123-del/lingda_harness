// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceFlowPageProps } from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { FlowPanelIcon, WorkspaceFlowPage } from '../src/client/rows/WorkspaceFlowPage.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t: WorkspaceFlowPageProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as WorkspaceFlowPageProps['useResource']
const usePanelInfo: WorkspaceFlowPageProps['usePanelInfo'] = selector => selector({ activePanelId: null })

const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt, ...overrides,
})
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const workspace = (id: string, sessionIds: readonly string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})
const noPending: SessionPendingInteractionSnapshot = new Map()

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount(options: {
  flowTarget?: string | null
  workspaces?: readonly WorkspaceView[]
  sessions?: readonly SessionSummary[]
  overrides?: Partial<WorkspaceFlowPageProps>
} = {}) {
  const store = createWorkspaceViewStore().create()
  if (options.flowTarget !== undefined) store.actions.setFlowTarget(options.flowTarget)
  const props: WorkspaceFlowPageProps = {
    useSessions: hook(sessionState(options.sessions ?? [])),
    useWorkspaces: hook(workspaceState(options.workspaces ?? [workspace('alpha', [], 'Alpha')])),
    useSessionPendingInteraction: hook(noPending),
    usePanelInfo, useResource,
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    open: vi.fn(),
    close: vi.fn(),
    t,
    ...options.overrides,
  }
  const view = render(<WorkspaceFlowPage {...props} />)
  return { view, props, store, rerender: (next: Partial<WorkspaceFlowPageProps>) => {
    Object.assign(props, next)
    view.rerender(<WorkspaceFlowPage {...props} />)
  } }
}

describe('WorkspaceFlowPage', () => {
  it('asks for a workspace target when none is recorded', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('流程总览')
    expect(screen.getByText('从工作区的“流程总览”操作打开某个工作区')).toBeTruthy()
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })

  it('renders one column per stage with cards in the right stage', () => {
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['running', 'started', 'planned', 'settled'], 'Alpha')],
      sessions: [
        summary('running', 50, { running: true }),
        summary('started', 40, {
          projectionValues: { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] },
        }),
        summary('planned', 30, { projectionValues: { turnOutline: [] } }),
        summary('settled', 20, {
          projectionValues: { turnOutline: [{ turn: 0, seq: SessionSeq(1), prompt: 'go', response: 'done' }] },
        }),
      ],
    })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Alpha')
    expect(screen.getByText('4 个会话，1 个已完成')).toBeTruthy()
    const columns = Array.from(document.querySelectorAll('section[aria-label]'))
    expect(columns.map(column => column.getAttribute('aria-label'))).toEqual([
      '等待处理', '工作中', '进行中', '待工作', '已完成',
    ])
    expect(columns[1]!.textContent).toContain('running')
    expect(columns[2]!.textContent).toContain('started')
    expect(columns[2]!.textContent).toContain('1/2 个任务')
    expect(columns[3]!.textContent).toContain('planned')
    expect(columns[4]!.textContent).toContain('settled')
    // Empty stages state that fact instead of rendering a bare column.
    expect(columns[0]!.textContent).toContain('没有会话')
  })

  it('reports a Workspace without sessions and one with pending attention', () => {
    mount({ flowTarget: 'alpha', workspaces: [workspace('alpha', [], 'Alpha')] })
    expect(screen.getByText('这个工作区还没有会话')).toBeTruthy()
  })

  it('lists a Session awaiting the user under the waiting column', () => {
    const awaiting = summary('awaiting', 10, { running: true })
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['awaiting'], 'Alpha')],
      sessions: [awaiting],
      overrides: {
        // The merged pending-interaction union carries private domain classes;
        // the page reads only `kind`, so a literal stands in for the entry.
        useSessionPendingInteraction: hook(new Map([[
          awaiting.id, { key: 'q:1', kind: 'question', sessionId: awaiting.id },
        ]]) as unknown as SessionPendingInteractionSnapshot),
      },
    })
    const waiting = document.querySelector('section[aria-label="等待处理"]')!
    expect(waiting.textContent).toContain('awaiting')
  })

  it('dates a just-active card with the now bucket', () => {
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['busy'], 'Alpha')],
      sessions: [summary('busy', Date.now(), { projectionValues: { turnOutline: [] } })],
    })
    expect(screen.getByRole('button', { name: /busy/ }).textContent).toContain('刚刚')
  })

  it('shows a provisional blank Session with the localized title and no time', () => {
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['fresh'], 'Alpha')],
      sessions: [summary('fresh', Date.now(), { blank: true })],
    })
    const card = screen.getByRole('button', { name: /^新会话/ })
    expect(card.textContent).toBe('新会话')
  })

  it('expands a card in place instead of navigating, then opens the Session on request', () => {
    const open = vi.fn()
    const close = vi.fn()
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['planned'], 'Alpha')],
      sessions: [summary('planned', 30, {
        projectionValues: {
          turnOutline: [{ turn: 1, seq: SessionSeq(1), prompt: '做一个订单脚本', response: '已生成 orders.mjs' }],
          todos: [{ content: '读取订单数据', status: 'completed' }, { content: '输出 CSV', status: 'pending' }],
        },
      })],
      overrides: { open, close },
    })
    const summaryRow = screen.getByRole('button', { name: /planned/ })
    expect(summaryRow.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(summaryRow)
    // Expanding reveals the work itself and does not navigate.
    expect(summaryRow.getAttribute('aria-expanded')).toBe('true')
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByText('读取订单数据')).toBeTruthy()
    expect(screen.getByText('输出 CSV')).toBeTruthy()
    // Completed and pending entries carry distinct markers.
    expect(screen.getByText('✓')).toBeTruthy()
    expect(screen.getByText('○')).toBeTruthy()
    expect(screen.getByText('做一个订单脚本')).toBeTruthy()
    expect(screen.getByText('已生成 orders.mjs')).toBeTruthy()
    // The explicit action is what opens the Session.
    fireEvent.click(screen.getByRole('button', { name: /打开会话/ }))
    expect(open).toHaveBeenCalledWith(sid('planned'))
    // Collapsing hides the detail again.
    fireEvent.click(summaryRow)
    expect(summaryRow.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('读取订单数据')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回会话' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('marks an in-progress task entry and tolerates a turn without a prompt', () => {
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['busy'], 'Alpha')],
      sessions: [summary('busy', 30, {
        projectionValues: {
          todos: [{ content: '执行中', status: 'in_progress' }],
          turnOutline: [{ turn: 2, seq: SessionSeq(2), prompt: '', response: '正在推进' }],
        },
      })],
    })
    fireEvent.click(screen.getByRole('button', { name: /busy/ }))
    expect(screen.getByText('▸')).toBeTruthy()
    expect(screen.getByText('（无提示词）')).toBeTruthy()
    expect(screen.getByText('正在推进')).toBeTruthy()
  })

  it('shows whole-log turn and step figures on the card summary', () => {
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['settled'], 'Alpha')],
      sessions: [summary('settled', 30, {
        projectionValues: {
          turnOutline: [{ turn: 1, seq: SessionSeq(1), prompt: 'q', response: 'a' }],
          sessionStats: {
            turns: 3, steps: 12, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
          },
        },
      })],
    })
    expect(screen.getByRole('button', { name: /settled/ }).textContent).toContain('3 轮 · 12 步')
  })

  it('keeps a card without recorded detail unexpandable', () => {
    mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', ['quiet'], 'Alpha')],
      sessions: [summary('quiet', 30, { projectionValues: { turnOutline: [] } })],
    })
    const card = screen.getByRole('button', { name: /quiet/ })
    expect(card.hasAttribute('aria-expanded')).toBe(false)
    fireEvent.click(card)
    expect(card.hasAttribute('aria-expanded')).toBe(false)
    expect(screen.queryByRole('button', { name: /打开会话/ })).toBeNull()
  })

  it('retargets the page from the workspace switcher', () => {
    const { store } = mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', [], 'Alpha'), workspace('beta', [], 'Beta')],
    })
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    expect(store.getSnapshot().flowTarget).toBe('beta')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('falls back to the request when the recorded Workspace has disappeared', () => {
    mount({ flowTarget: 'gone', workspaces: [workspace('alpha', [], 'Alpha')] })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('流程总览')
    expect(screen.getByText('从工作区的“流程总览”操作打开某个工作区')).toBeTruthy()
  })

  it('renders the sidebar panel-row glyph at the requested size', () => {
    const view = render(<FlowPanelIcon size={18} />)
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('18')
  })

  it('closes the switcher without retargeting when dismissed', () => {
    const { store } = mount({
      flowTarget: 'alpha',
      workspaces: [workspace('alpha', [], 'Alpha'), workspace('beta', [], 'Beta')],
    })
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(store.getSnapshot().flowTarget).toBe('alpha')
  })
})
