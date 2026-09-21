// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GitCheckpointAudit } from '../src/client/types.ts'
import { GitWorkspaceView } from '../src/client/GitWorkspaceView.tsx'
import { RepositoryFlow } from '../src/client/RepositoryFlow.tsx'
import { zh } from '../src/client/locales.ts'
import { entry } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

function checkpointEntries(): SessionEventLikeEntry[] {
  return [entry(1, 'agent/git-checkpoint', {
    turn: 1, phase: 'after', cwd: '/tmp/demo-repo', branch: 'main',
    status: ' M src/index.ts\n?? notes.md',
    diffStat: ' 2 files changed, 4 insertions(+), 1 deletion(-)',
  })]
}

describe('repository flow', () => {
  it('adds a local repository target and renders the checkpoint flow', () => {
    render(<RepositoryFlow checkpoints={checkpointEntries().map(item => (item.event as { data: GitCheckpointAudit }).data)} t={key => zh[key]} />)
    expect(screen.getByText(zh.gitFlowTitle)).toBeTruthy()
    expect(screen.getByText(zh.gitFlowSource)).toBeTruthy()
    expect(screen.getByRole('tab', { name: zh.gitViewTree }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: zh.gitViewFlow }))
    expect(screen.getByRole('tab', { name: zh.gitViewFlow }).getAttribute('aria-selected')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: zh.gitAddress }), { target: { value: '/tmp/demo-repo' } })
    fireEvent.click(screen.getByRole('button', { name: zh.gitAdd }))
    expect(screen.getAllByText('/tmp/demo-repo').length).toBeGreaterThan(0)
    expect(screen.getAllByText(zh.gitWatching).length).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem('dsh.repository.monitor.v1') ?? '[]')).toEqual([{ address: '/tmp/demo-repo', enabled: true }])
  })

  it('toggles and removes tracked repositories', () => {
    localStorage.setItem('dsh.repository.monitor.v1', JSON.stringify([{ address: '/tmp/demo-repo', enabled: true }]))
    render(<RepositoryFlow checkpoints={[]} t={key => zh[key]} />)
    const toggle = screen.getByRole('switch', { name: `${zh.gitMonitorToggle}: /tmp/demo-repo` })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: zh.gitRemove }))
    expect(screen.queryByText('/tmp/demo-repo')).toBeNull()
  })

  it('marks a GitCode remote as connected when the local checkpoint reports the same origin', () => {
    const checkpoint = {
      turn: 1, phase: 'after' as const, cwd: '/tmp/workspace', repositoryRoot: '/tmp/workspace/DSH-diaoshi',
      remote: 'https://gitcode.com/XJ-Cyber/DSH-diaoshi.git', branch: 'main', status: '', diffStat: '',
    } satisfies GitCheckpointAudit
    localStorage.setItem('dsh.repository.monitor.v1', JSON.stringify([{ address: 'https://gitcode.com/XJ-Cyber/DSH-diaoshi.git', enabled: true }]))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }))
    render(<RepositoryFlow checkpoints={[checkpoint]} t={key => zh[key]} />)
    expect(screen.getAllByText(zh.gitWatching).length).toBeGreaterThan(0)
  })

  it('shows committed update points separately from uncommitted worktree changes', () => {
    const checkpoint = {
      turn: 1, phase: 'after' as const, cwd: '/tmp/demo-repo', branch: 'main', status: '', diffStat: '',
      localHead: '9031904f283950e4684907d8f9df57e0054f75fe', remoteHead: '9031904f283950e4684907d8f9df57e0054f75fe', syncState: 'synced' as const,
      commits: [{ sha: '9031904f283950e4684907d8f9df57e0054f75fe', message: 'feat: plane', author: 'XJ-Cyber', date: '2026-09-20T00:00:00Z', files: ['plane.html', 'plane.test.cjs'] }],
    } satisfies GitCheckpointAudit
    render(<GitWorkspaceView checkpoints={[checkpoint]} t={key => zh[key]} />)
    expect(screen.getByText(zh.gitNoChanges)).toBeTruthy()
    expect(screen.getByText(zh.gitRecentCommits)).toBeTruthy()
    expect(screen.getByText('feat: plane')).toBeTruthy()
    expect(screen.getByText('plane.html')).toBeTruthy()
    expect(screen.getByText(zh.gitSyncSynced)).toBeTruthy()
  })
})
