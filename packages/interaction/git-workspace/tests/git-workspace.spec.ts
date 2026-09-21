import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import GitWorkspaceService from '../src/index.ts'

describe('git workspace plugin', () => {
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
