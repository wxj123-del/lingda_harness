import { describe, expect, it, vi } from 'vitest'
import { fetchRepositorySnapshot, normalizeRepositoryAddress, parseGitHubAddress, parseHostedRepositoryAddress } from '../src/client/repository-monitor.ts'

describe('repository monitor address parsing', () => {
  it('accepts public GitHub URLs and strips the optional .git suffix', () => {
    expect(parseGitHubAddress('https://github.com/deepseek-ai/deepseek-harness.git')).toEqual({
      owner: 'deepseek-ai', repo: 'deepseek-harness',
    })
  })

  it('rejects non-GitHub and incomplete addresses', () => {
    expect(parseGitHubAddress('/Users/von/wxj/my_project/DSH')).toBeNull()
    expect(parseGitHubAddress('https://gitlab.com/example/repo')).toBeNull()
    expect(parseGitHubAddress('https://github.com/example')).toBeNull()
  })

  it('normalizes GitCode and SCP-style remotes for local checkpoint matching', () => {
    expect(normalizeRepositoryAddress('https://gitcode.com/XJ-Cyber/DSH-diaoshi.git')).toBe('gitcode.com/XJ-Cyber/DSH-diaoshi')
    expect(normalizeRepositoryAddress('git@gitcode.com:XJ-Cyber/DSH-diaoshi.git')).toBe('gitcode.com/XJ-Cyber/DSH-diaoshi')
  })

  it('accepts GitCode URLs for remote commit monitoring', () => {
    expect(parseHostedRepositoryAddress('https://gitcode.com/XJ-Cyber/DSH-diaoshi.git')).toEqual({
      host: 'gitcode.com', owner: 'XJ-Cyber', repo: 'DSH-diaoshi',
    })
  })

  it('projects a bounded public repository response into a commit timeline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ default_branch: 'main' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{
        sha: 'abcdef1234567890', html_url: 'https://github.com/example/repo/commit/abcdef1',
        commit: { message: 'Update readme\n\nDetails', author: { name: 'Maintainer', date: '2026-09-20T00:00:00Z' } },
      }]) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchRepositorySnapshot('https://github.com/example/repo')
    expect(result).toMatchObject({ name: 'example/repo', branch: 'main' })
    expect(result.commits).toEqual([expect.objectContaining({ sha: 'abcdef1234567890', message: 'Update readme', author: 'Maintainer' })])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads GitCode commits without requiring repository metadata access', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{
      sha: '9031904f283950e4684907d8f9df57e0054f75fe', html_url: 'https://gitcode.com/XJ-Cyber/DSH-diaoshi/commits/detail/9031904',
      commit: { message: 'feat: plane', author: { date: '2026-09-20T00:00:00Z' } },
    }]) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchRepositorySnapshot('https://gitcode.com/XJ-Cyber/DSH-diaoshi.git')
    expect(result).toMatchObject({ name: 'XJ-Cyber/DSH-diaoshi', branch: 'main' })
    expect(result.commits[0]).toEqual(expect.objectContaining({ message: 'feat: plane' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
