// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SessionSeq, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionMapViewProps } from '../src/client/SessionMapView.tsx'
import { SessionMapView } from '../src/client/SessionMapView.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: SessionMapViewProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string) => id as SessionId
const SELF = sid('self')

const summary = (id: string, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt: 0, ...overrides,
})
const listOf = (...items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
})
const turn = (n: number) => ({
  turn: n, seq: SessionSeq(n * 10), prompt: `提示${n}`, response: `回复${n}`,
})
const running = (value: boolean) => vi.fn((selector: (state: { running: boolean }) => unknown) => selector({ running: value }))

function mount(options: {
  outline?: unknown
  sessions?: SessionSummary[]
  isRunning?: boolean
  forkAt?: SessionMapViewProps['forkAt']
  openSession?: SessionMapViewProps['openSession']
} = {}) {
  const props = {
    useSession: running(options.isRunning ?? false) as unknown as SessionMapViewProps['useSession'],
    useProjection: ((key: string, selector?: (value: unknown) => unknown) => {
      const value = key === 'turnOutline' ? options.outline : undefined
      return selector === undefined ? value : selector(value)
    }) as unknown as SessionMapViewProps['useProjection'],
    useSessions: ((selector: (state: SessionListState) => unknown) =>
      selector(listOf(...(options.sessions ?? [])))) as unknown as SessionMapViewProps['useSessions'],
    sessionId: SELF,
    forkAt: options.forkAt ?? vi.fn(async () => {}),
    openSession: options.openSession ?? vi.fn(),
    t,
  } as unknown as SessionMapViewProps
  const view = render(<SessionMapView {...props} />)
  return { view, props }
}

describe('SessionMapView', () => {
  it('states the empty map and its hint before the first turn', () => {
    mount({ outline: [] })
    expect(screen.getByRole('heading', { name: '会话地图' })).toBeTruthy()
    expect(screen.getByText('这个会话还没有完成的回合')).toBeTruthy()
    expect(screen.getByText('发送第一条消息后，每轮对话都会成为地图上的一格')).toBeTruthy()
  })

  it('renders one spine row per turn with prompt and response previews', () => {
    mount({ outline: [turn(1), turn(2)] })
    expect(screen.getByText('2 个回合 · 0 个分支')).toBeTruthy()
    expect(screen.getByText('第 1 轮')).toBeTruthy()
    expect(screen.getByText('第 2 轮')).toBeTruthy()
    expect(screen.getByText('提示1')).toBeTruthy()
    expect(screen.getByText('回复2')).toBeTruthy()
  })

  it('shows a placeholder for a turn whose prompt is not recorded', () => {
    mount({ outline: [{ ...turn(1), prompt: '' }] })
    expect(screen.getByText('（无提示词）')).toBeTruthy()
  })

  it('forks the viewed Session at the clicked turn', async () => {
    const forkAt = vi.fn(async () => {})
    mount({ outline: [turn(1), turn(2)], forkAt })
    const buttons = screen.getAllByRole('button', { name: '从这里分叉' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    await waitFor(() => { expect(forkAt).toHaveBeenCalledWith(SessionSeq(20)) })
  })

  it('surfaces a fork failure and keeps the row actionable', async () => {
    const forkAt = vi.fn(async () => { throw new Error('turn open') })
    mount({ outline: [turn(1)], forkAt })
    fireEvent.click(screen.getByRole('button', { name: '从这里分叉' }))
    expect((await screen.findByRole('alert')).textContent).toContain('分叉失败：turn open')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '从这里分叉' }).disabled).toBe(false)
  })

  it('blocks forking while the Session runs', () => {
    mount({ outline: [turn(1)], isRunning: true })
    const button = screen.getByRole<HTMLButtonElement>('button', { name: '从这里分叉' })
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toBe('会话忙碌时不能分叉')
  })

  it('attaches a fork to its source turn and opens it', () => {
    const openSession = vi.fn()
    mount({
      outline: [turn(1), turn(2)],
      sessions: [
        summary('self'),
        summary('branch-a', { parentId: SELF, displayTitle: 'Branch A', projectionValues: { turnOutline: [turn(1)] } }),
      ],
      openSession,
    })
    expect(screen.getByText('2 个回合 · 1 个分支')).toBeTruthy()
    // The branch sits under turn 1, not turn 2.
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('Branch A')
    expect(rows[1]!.textContent).not.toContain('Branch A')
    fireEvent.click(screen.getByRole('button', { name: /Branch A/ }))
    expect(openSession).toHaveBeenCalledWith(sid('branch-a'))
  })

  it('lists a branch without an outline under the unattached section', () => {
    mount({
      outline: [turn(1)],
      sessions: [summary('self'), summary('orphan', { parentId: SELF, displayTitle: 'Orphan' })],
    })
    expect(screen.getByText('未能定位的分支')).toBeTruthy()
    expect(screen.getByText('这些分支缺少自己的回合大纲，无法判断从哪一轮分出')).toBeTruthy()
    const chip = screen.getByRole('button', { name: /Orphan/ })
    // An unknown outline is stated, not rendered as a zero count.
    expect(chip.textContent).toContain('轮次未知')
    expect(chip.textContent).not.toContain('0 轮')
  })

  it('ignores subagent-origin children, which the browser never lists as forks', () => {
    mount({
      outline: [turn(1)],
      sessions: [
        summary('self'),
        summary('child', { parentId: SELF, origin: 'subagent', projectionValues: { turnOutline: [turn(1)] } }),
      ],
    })
    expect(screen.getByText('1 个回合 · 0 个分支')).toBeTruthy()
  })

  it('marks a running branch and counts its turns', () => {
    mount({
      outline: [turn(1)],
      sessions: [
        summary('self'),
        summary('busy', {
          parentId: SELF, running: true,
          projectionValues: { turnOutline: [turn(1), turn(2)] },
        }),
      ],
    })
    const chip = screen.getByRole('button', { name: /busy/ })
    expect(chip.textContent).toContain('2 轮')
    expect(chip.textContent).toContain('运行中')
  })

  it('uses the singular branch-turn copy for a one-turn branch', () => {
    mount({
      outline: [turn(1)],
      sessions: [
        summary('self'),
        summary('one', { parentId: SELF, projectionValues: { turnOutline: [turn(1)] } }),
      ],
    })
    expect(screen.getByRole('button', { name: /one/ }).textContent).toContain('1 轮')
  })

  it('ignores a malformed outline instead of rendering broken rows', () => {
    mount({ outline: 'not-an-array' })
    expect(screen.getByText('这个会话还没有完成的回合')).toBeTruthy()
  })

  it('surfaces a non-Error rejection as text', async () => {
    const forkAt = vi.fn(async () => { throw 'plain failure' })
    mount({ outline: [turn(1)], forkAt })
    fireEvent.click(screen.getByRole('button', { name: '从这里分叉' }))
    expect((await screen.findByRole('alert')).textContent).toBe('分叉失败：plain failure')
  })

  it('reports a fork in flight without double-submitting', async () => {
    let settle!: () => void
    const forkAt = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    mount({ outline: [turn(1), turn(2)], forkAt })
    const first = screen.getAllByRole('button', { name: '从这里分叉' })
    fireEvent.click(first[0]!)
    // Every row is gated while the fork is in flight.
    const gated = screen.getAllByRole<HTMLButtonElement>('button', { name: '从这里分叉' })
    expect(gated.every(button => button.disabled)).toBe(true)
    fireEvent.click(gated[1]!)
    expect(forkAt).toHaveBeenCalledOnce()
    await act(async () => { settle() })
    await waitFor(() => {
      const buttons = screen.getAllByRole<HTMLButtonElement>('button', { name: '从这里分叉' })
      expect(buttons.every(button => !button.disabled)).toBe(true)
    })
  })
})
