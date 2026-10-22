import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as TaskState from '@deepseek-ai/dsh-task-state'
import type { TaskState as Snapshot } from '@deepseek-ai/dsh-task-state/types'

interface Bench {
  ctx: Context
  session: Session
  values(): Record<string, unknown>
}

async function harness(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TaskState, { injectTaskCard: true, recordCommandEvidence: true })
  const session = ctx.sessions.create()
  await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return {
    ctx,
    session,
    values: () => ctx.sessionProjections.snapshot(session).values,
  }
}

function snapshot(session: Session, task: Snapshot | null): void {
  session.append('task/state', { task }, { ignorable: true })
}

describe('task projection provider', () => {
  it('serves null before the first write', async () => {
    const bench = await harness()
    expect(bench.values().task).toBeNull()
  })

  it('serves the latest whole snapshot (last-write-wins)', async () => {
    const bench = await harness()
    const first: Snapshot = {
      revision: 1,
      objective: 'a',
      status: 'active',
      acceptance: ['x'],
      evidence: [],
      decisions: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const second: Snapshot = { ...first, revision: 2, status: 'blocked' }
    snapshot(bench.session, first)
    snapshot(bench.session, second)
    expect(bench.values().task).toEqual(second)
  })

  it('survives turn boundaries, unlike the per-turn todo list', async () => {
    const bench = await harness()
    const task: Snapshot = {
      revision: 1,
      objective: 'long job',
      status: 'active',
      acceptance: ['tests'],
      evidence: [],
      decisions: [],
      createdAt: 1,
      updatedAt: 1,
    }
    bench.session.append('turn/start', { turn: 1 })
    snapshot(bench.session, task)
    bench.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    bench.session.append('turn/start', { turn: 2 })
    expect(bench.values().task).toEqual(task)
  })

  it('survives a surface replacement that shadows earlier history', async () => {
    const bench = await harness()
    const session = bench.session
    // The seeded user message is surface node 0; compaction replaces contiguous
    // surface nodes, never the boundary markers around them.
    const head = session.surface.nodes[0]
    if (head === undefined) throw new Error('expected a seeded surface node')
    session.append('turn/start', { turn: 1 })
    const task: Snapshot = {
      revision: 1,
      objective: 'survive compaction',
      status: 'active',
      acceptance: ['done'],
      evidence: [],
      decisions: [],
      createdAt: 1,
      updatedAt: 1,
    }
    snapshot(session, task)
    const message = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'work' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // A compaction replacement shadows the visible history before it with a
    // single checkpoint message; the task projection is event-sourced and must
    // still report the current snapshot.
    const checkpoint = createUserMessage({
      content: [{ type: 'text', text: '<compacted-summary>summary</compacted-summary>' }],
      source: { kind: 'plugin', plugin: 'compaction', form: 'notice', summary: 'checkpoint' },
    })
    session.append('user/message', checkpoint, {
      surfaceOp: { op: 'replace', startSeq: head, endSeq: message.seq },
      sourceEventSeqs: [head, message.seq],
    })
    expect(session.deriveMessages().some(item => item.id === message.data.id)).toBe(false)
    expect(bench.values().task).toEqual(task)
  })

  it('clears on an explicit null snapshot', async () => {
    const bench = await harness()
    snapshot(bench.session, {
      revision: 1,
      objective: 'x',
      status: 'active',
      acceptance: [],
      evidence: [],
      decisions: [],
      createdAt: 1,
      updatedAt: 1,
    })
    snapshot(bench.session, null)
    expect(bench.values().task).toBeNull()
  })

  it('drops the key when the plugin unloads', async () => {
    const bench = await harness()
    expect('task' in bench.values()).toBe(true)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(TaskState, { injectTaskCard: true, recordCommandEvidence: true })
    const session = ctx.sessions.create()
    await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    expect('task' in ctx.sessionProjections.snapshot(session).values).toBe(true)
    await fiber.dispose()
    expect('task' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
