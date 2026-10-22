// @vitest-environment jsdom
/**
 * The panel's rendering against a settled snapshot: what it lists, what it
 * offers, and what it refuses to commit.
 *
 * The component is driven through its four prop shares with plain fakes — the
 * store handle is the real factory so the reads the body performs are the ones
 * production performs, and the face is a recorder.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import type { RepositoryChangeSnapshot } from '@deepseek-ai/dsh-git-workspace'
import { RepositoryBody } from '../src/client/RepositoryBody.tsx'
import { createRepositoryStore } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import type { SidebarRepositoryKey } from '../src/client/locales.ts'

const t = (key: SidebarRepositoryKey, params?: Record<string, unknown>) => {
  const template = zh[key]
  if (params === undefined) return template
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template)
}
const tabId = 'tab-1' as never
const sessionId = 'session-1'

afterEach(cleanup)

const snapshot: RepositoryChangeSnapshot = {
  repositoryRoot: '/tmp/repo',
  remote: 'git@example.com:acme/repo.git',
  branch: 'feat/sidebar',
  localHead: 'a'.repeat(40),
  upstreamBranch: 'origin/feat/sidebar',
  ahead: 2,
  behind: 1,
  syncState: 'diverged',
  status: 'M  src/staged.ts\n M src/unstaged.ts\n?? src/new.ts',
  diffStat: '',
  diff: '',
  commits: [{ sha: 'abcdef1234567', message: 'feat: panel', author: 'Ada', date: '2026-10-17T09:00:00.000Z', files: [] }],
}

/**
 * Render the panel with one settled tab bucket.
 * @param state - overrides merged into the seeded bucket.
 * @param face - recorders for the injected operations.
 * @returns the recorders.
 */
function renderPanel(
  state: { repositoryRoot?: string; snapshot?: RepositoryChangeSnapshot; message?: string } = {},
  face: Partial<Record<'start' | 'reload' | 'apply' | 'commit' | 'pull', ReturnType<typeof vi.fn>>> = {},
) {
  const store = createRepositoryStore()
  const handle = store.create()
  handle.actions.start(tabId)
  handle.actions.located(tabId, '/tmp/repo')
  if (state.snapshot !== undefined) handle.actions.loaded(tabId, state.snapshot)
  if (state.message !== undefined) handle.actions.typed(tabId, state.message)
  const recorders = {
    start: face.start ?? vi.fn(),
    reload: face.reload ?? vi.fn(),
    apply: face.apply ?? vi.fn(),
    commit: face.commit ?? vi.fn(),
    pull: face.pull ?? vi.fn(),
  }
  const useTabInfo = () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane1' },
    tab: {
      id: tabId,
      kind: 'repository',
      title: '源代码管理',
      visible: true,
      navigation: {},
      signal: new AbortController().signal,
      actions: { openResource: vi.fn() },
    },
  }) as never
  const useStore = ((selector: (value: { byTab: Record<string, unknown> }) => unknown) => selector(handle.getSnapshot())) as never
  const props = {
    useTabInfo,
    sessionId,
    useSessions: (selector: (value: { byId: Record<string, { cwd: string }> }) => unknown) =>
      selector({ byId: { [sessionId]: { cwd: '/tmp/repo' } } }),
    useStore,
    actions: handle.actions,
    t,
    ...recorders,
  } as unknown as Parameters<typeof RepositoryBody>[0]
  render(createElement(RepositoryBody, props))
  return recorders
}

describe('RepositoryBody', () => {
  it('shows the branch, both groups, and the recent commits', () => {
    renderPanel({ snapshot, message: '' })
    expect(screen.getByText('feat/sidebar')).toBeTruthy()
    expect(screen.getByText('staged.ts')).toBeTruthy()
    expect(screen.getByText('unstaged.ts')).toBeTruthy()
    expect(screen.getByText('new.ts')).toBeTruthy()
    expect(screen.getByText('feat: panel')).toBeTruthy()
    // The sync line names the divergence rather than staying silent.
    expect(screen.getByText('本地与远端已分叉')).toBeTruthy()
    // Group counts are drawn from the two columns.
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('stages an unstaged file through the face', () => {
    const recorders = renderPanel({ snapshot })
    const button = screen.getByLabelText(/暂存此文件: src\/unstaged\.ts/)
    fireEvent.click(button)
    expect(recorders.apply).toHaveBeenCalledWith(tabId, ['src/unstaged.ts'], true, expect.anything())
  })

  it('unstages a staged file through the face', () => {
    const recorders = renderPanel({ snapshot })
    const button = screen.getByLabelText(/取消暂存: src\/staged\.ts/)
    fireEvent.click(button)
    expect(recorders.apply).toHaveBeenCalledWith(tabId, ['src/staged.ts'], false, expect.anything())
  })

  it('refuses a commit without a message', () => {
    renderPanel({ snapshot, message: '   ' })
    const commit = screen.getByRole('button', { name: '提交' })
    expect(commit.hasAttribute('disabled')).toBe(true)
  })

  it('commits the staged set with the typed message', () => {
    const recorders = renderPanel({ snapshot, message: 'feat: from panel' })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    expect(recorders.commit).toHaveBeenCalledWith(tabId, 'feat: from panel', expect.anything())
  })

  it('says where it stands when the workspace is not a repository', () => {
    const store = createRepositoryStore()
    const handle = store.create()
    handle.actions.start(tabId)
    handle.actions.located(tabId, undefined)
    const useTabInfo = () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane1' },
      tab: { id: tabId, kind: 'repository', title: '源代码管理', visible: true, navigation: {}, signal: new AbortController().signal, actions: {} },
    }) as never
    const noRepositoryProps = {
      useTabInfo,
      sessionId,
      useSessions: (selector: (value: { byId: Record<string, { cwd: string }> }) => unknown) =>
        selector({ byId: { [sessionId]: { cwd: '/tmp/plain' } } }),
      useStore: (selector: (value: unknown) => unknown) => selector(handle.getSnapshot()),
      actions: handle.actions,
      t,
      start: vi.fn(),
      reload: vi.fn(),
      apply: vi.fn(),
      commit: vi.fn(),
      pull: vi.fn(),
    } as unknown as Parameters<typeof RepositoryBody>[0]
    render(createElement(RepositoryBody, noRepositoryProps))
    expect(screen.getByText('工作区不在 Git 仓库内。')).toBeTruthy()
  })
})
