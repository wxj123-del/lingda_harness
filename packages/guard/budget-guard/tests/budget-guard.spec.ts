import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as BudgetGuard from '@deepseek-ai/dsh-budget-guard'
import type { Config } from '@deepseek-ai/dsh-budget-guard'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function harness(adapter: MockAdapter, config: Config): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(BudgetGuard, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

function stops(agent: Agent): Extract<SessionEvent, { type: 'budget/stop' }>[] {
  return agent.session.snapshotEvents()
    .filter((event): event is Extract<SessionEvent, { type: 'budget/stop' }> => event.type === 'budget/stop')
}

function turnEnds(agent: Agent): SessionEvent<'turn/end'>[] {
  return agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
}

describe('budget guard', () => {
  it('stops a turn once the step budget is exhausted', async () => {
    // Three model steps are scripted; a two-step cap must stop before the third.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'a', status: 'pending' }] }),
      toolCallResponse('c2', 'todo_write', { todos: [{ content: 'a', status: 'in_progress' }] }),
      textResponse('never reached'),
    ])
    const ctx = await harness(adapter, { maxStepsPerTurn: 2, warnAtRatio: 1 })
    await ctx.plugin(await import('@deepseek-ai/dsh-tool-todo'), { allowParallelInProgress: true })
    const agent = await ctx.agentLoop.create(SessionId('budget-steps'), { provider: 'mock', model: 'mock' })

    ask(agent, 'loop')
    await waitForIdle(ctx, agent)

    const recorded = stops(agent)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.data).toMatchObject({ reason: 'steps', limit: 2, observed: 3 })
    expect(turnEnds(agent).at(-1)?.data.reason.kind).toBe('blocked')
    expect(adapter.requests).toHaveLength(2)
  })

  it('does not stop a turn that finishes within budget', async () => {
    const adapter = new MockAdapter([textResponse('done')])
    const ctx = await harness(adapter, { maxStepsPerTurn: 5, warnAtRatio: 1 })
    const agent = await ctx.agentLoop.create(SessionId('budget-ok'), { provider: 'mock', model: 'mock' })

    ask(agent, 'quick')
    await waitForIdle(ctx, agent)

    expect(stops(agent)).toHaveLength(0)
    expect(turnEnds(agent).at(-1)?.data.reason.kind).toBe('completed')
  })

  it('stops on the cumulative token budget', async () => {
    // Each scripted response reports 10 input + 5 output tokens; a 12-token cap
    // is exceeded after the second request.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'a', status: 'pending' }] }),
      toolCallResponse('c2', 'todo_write', { todos: [{ content: 'a', status: 'in_progress' }] }),
      textResponse('never reached'),
    ])
    const ctx = await harness(adapter, { maxTokensPerTurn: 12, warnAtRatio: 1 })
    await ctx.plugin(await import('@deepseek-ai/dsh-tool-todo'), { allowParallelInProgress: true })
    const agent = await ctx.agentLoop.create(SessionId('budget-tokens'), { provider: 'mock', model: 'mock' })

    ask(agent, 'loop')
    await waitForIdle(ctx, agent)

    const recorded = stops(agent)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.data.reason).toBe('tokens')
    expect(recorded[0]?.data.observed).toBeGreaterThan(12)
  })

  it('enforces a session-wide turn cap', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter, { maxTurns: 1, warnAtRatio: 1 })
    const agent = await ctx.agentLoop.create(SessionId('budget-turns'), { provider: 'mock', model: 'mock' })

    ask(agent, 'first')
    await waitForIdle(ctx, agent)
    ask(agent, 'second')
    await waitForIdle(ctx, agent)

    const recorded = stops(agent)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.data).toMatchObject({ turn: 2, limit: 1, observed: 2 })
    expect(adapter.requests).toHaveLength(1)
  })

  it('injects one handoff warning before the budget is exhausted', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'a', status: 'pending' }] }),
      textResponse('wrapped up'),
    ])
    const ctx = await harness(adapter, { maxStepsPerTurn: 2, warnAtRatio: 0.5 })
    await ctx.plugin(await import('@deepseek-ai/dsh-tool-todo'), { allowParallelInProgress: true })
    const agent = await ctx.agentLoop.create(SessionId('budget-warn'), { provider: 'mock', model: 'mock' })

    ask(agent, 'loop')
    await waitForIdle(ctx, agent)

    const warnings = agent.session.snapshotEvents().filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'budget-guard')
    expect(warnings).toHaveLength(1)
    expect(stops(agent)).toHaveLength(0)
  })

  it('rejects invalid configuration at load', () => {
    const ctx = new Context()
    expect(() => BudgetGuard.apply(ctx, { maxStepsPerTurn: 0, warnAtRatio: 0.8 }))
      .toThrow(/positive safe integer/)
    expect(() => BudgetGuard.apply(new Context(), { maxStepsPerTurn: 3, warnAtRatio: 2 }))
      .toThrow(/warnAtRatio/)
  })
})
