import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import GitWorkspaceService from '../src/index.ts'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 })
  return result.stdout.trim()
}

async function localRepository(): Promise<{ root: string; remote: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-workspace-'))
  const remote = join(root, 'remote.git')
  const checkout = join(root, 'checkout')
  await git(root, ['init', '--bare', remote])
  await git(root, ['clone', remote, checkout])
  await git(checkout, ['config', 'user.email', 'test@example.com'])
  await git(checkout, ['config', 'user.name', 'Test User'])
  await writeFile(join(checkout, 'README.md'), 'initial\n')
  await git(checkout, ['add', 'README.md'])
  await git(checkout, ['commit', '-m', 'initial'])
  await git(checkout, ['branch', '-M', 'main'])
  await git(checkout, ['push', '-u', 'origin', 'main'])
  return { root: checkout, remote }
}

describe('git workspace plugin', () => {
  it('inspects local changes and commits/pushes them explicitly', async () => {
    const ctx = new Context()
    await ctx.plugin(GitWorkspaceService)
    const repository = await localRepository()
    await writeFile(join(repository.root, 'README.md'), 'changed\n')
    await writeFile(join(repository.root, 'notes.md'), 'untracked\n')
    const snapshot = await ctx.gitWorkspace.inspect(repository.root)
    expect(snapshot.status).toContain('README.md')
    expect(snapshot.diff).toContain('+changed')
    expect(snapshot.diff).toContain('+untracked')
    await expect(ctx.gitWorkspace.push({ repositoryRoot: repository.root })).rejects.toThrow('请填写提交说明')
    const result = await ctx.gitWorkspace.push({ repositoryRoot: repository.root, message: 'feat: update readme' })
    expect(result.committed).toBe(true)
    expect(result.pushed).toBe(true)
    expect(result.status).toBe('')
    expect(result.ahead).toBe(0)
  })

  it('rejects inspect and push requests outside a repository or without origin', async () => {
    const ctx = new Context()
    await ctx.plugin(GitWorkspaceService)
    const root = await mkdtemp(join(tmpdir(), 'dsh-git-invalid-'))
    await expect(ctx.gitWorkspace.inspect(root)).rejects.toThrow('目标路径不是 Git 仓库')
    const repository = join(root, 'repository')
    await mkdir(repository)
    await git(repository, ['init'])
    await git(repository, ['config', 'user.email', 'test@example.com'])
    await git(repository, ['config', 'user.name', 'Test User'])
    await writeFile(join(repository, 'README.md'), 'local\n')
    await git(repository, ['add', 'README.md'])
    await git(repository, ['commit', '-m', 'initial'])
    await expect(ctx.gitWorkspace.push({ repositoryRoot: repository, message: 'publish' })).rejects.toThrow('没有 origin 远端')
  })

  it('captures ordered before and after checkpoints for a session cwd', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(GitWorkspaceService)
    const session = ctx.sessions.create(SessionId(`git-${Math.random().toString(36).slice(2)}`), {
      meta: { cwd: process.cwd() },
    })

    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.sessions.flush(session)

    const checkpoints = session.snapshotEvents().filter(event => event.type === 'agent/git-checkpoint')
    expect(checkpoints.map(event => event.data.phase)).toEqual(['before', 'after'])
    expect(checkpoints[0]?.data.cwd).toBe(process.cwd())
    expect(checkpoints[0]?.data.branch).toEqual(expect.any(String))
    expect(checkpoints[0]?.data.status).toEqual(expect.any(String))
    expect(checkpoints[0]?.data.localHead).toEqual(expect.any(String))
    expect(checkpoints[0]?.data.commits).toEqual(expect.any(Array))
    expect(checkpoints[0]?.data.syncState).toEqual(expect.any(String))
  }, 15_000)

  it('records a bounded non-repository checkpoint without running Git diagnostics', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(GitWorkspaceService)
    const root = await mkdtemp(join(tmpdir(), 'dsh-git-workspace-plain-'))
    const session = ctx.sessions.create(SessionId(`git-plain-${Math.random().toString(36).slice(2)}`), {
      meta: { cwd: root },
    })

    session.append('turn/start', { turn: 1 })
    await ctx.sessions.flush(session)

    const checkpoint = session.snapshotEvents().find(event => event.type === 'agent/git-checkpoint')
    expect(checkpoint?.type).toBe('agent/git-checkpoint')
    if (checkpoint?.type !== 'agent/git-checkpoint') return
    expect(checkpoint.data.syncState).toBe('unknown')
    expect(checkpoint.data.error).toBe('cwd is not a Git repository')
    expect(checkpoint.data.error).not.toContain('fatal:')
    expect(checkpoint.data.status).toBeUndefined()
    expect(checkpoint.data.diff).toBeUndefined()
  })

  it('can be disabled without changing the session log', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(GitWorkspaceService, { enabled: false })
    const session = ctx.sessions.create(SessionId(`git-disabled-${Math.random().toString(36).slice(2)}`), {
      meta: { cwd: process.cwd() },
    })
    session.append('turn/start', { turn: 1 })
    await ctx.sessions.flush(session)
    expect(session.snapshotEvents().some(event => event.type === 'agent/git-checkpoint')).toBe(false)
  })
})
