import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AutoResume from '@deepseek-ai/dsh-auto-resume'
import type { Config } from '@deepseek-ai/dsh-auto-resume'
import * as BudgetGuard from '@deepseek-ai/dsh-budget-guard'
import * as TaskState from '@deepseek-ai/dsh-task-state'
import type { TaskState as Snapshot } from '@deepseek-ai/dsh-task-state/types'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

interface Bench {
  ctx: Context
  agent: Agent
  adapter: MockAdapter
}

async function harness(
  adapter: MockAdapter,
  options: {
    autoResume?: Partial<Config>
    budget?: { maxStepsPerTurn?: number }
    goals?: { get: (agent: Agent) => { activation?: string } | undefined }
  } = {},
): Promise<Bench> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TaskState, {
    injectTaskCard: true,
    recordCommandEvidence: true,
    requireVerifiedEvidence: true,
  })
  if (options.budget !== undefined) await ctx.plugin(BudgetGuard, { warnAtRatio: 1, ...options.budget })
  if (options.goals !== undefined) {
    // A stand-in goals service: the plugin only reads `get(agent).activation`.
    ctx.provide('goals', options.goals)
  }
  await ctx.plugin(AutoResume, {
    maxAutoResumes: 3,
    minIntervalMs: 0,
    requireHandoff: true,
    resumeOnError: false,
    ...options.autoResume,
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(`auto-${String(Math.random()).slice(2, 8)}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, agent, adapter }
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function latestTask(ctx: Context, agent: Agent): Snapshot | null {
  return ctx.sessionProjections.stateOf(agent.session, 'task') ?? null
}

function resumeAttempts(agent: Agent): Extract<SessionEvent, { type: 'auto-resume/attempt' }>[] {
  return agent.session.snapshotEvents()
    .filter((event): event is Extract<SessionEvent, { type: 'auto-resume/attempt' }> =>
      event.type === 'auto-resume/attempt')
}

/** Wait until the agent is idle and any pending resume scheduling has run. */
async function settle(agent: Agent): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await agent.whenIdle()
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const PLAN_WITH_HANDOFF = toolCallResponse('c1', 'task_update', {
  objective: 'Resume me',
  acceptance: ['done'],
  handoff: 'Continue from step two',
})

describe('auto resume', () => {
  it('resumes after a budget stop and lets the next turn finish', async () => {
    const adapter = new MockAdapter([
      // Turn 1: create the task, then keep calling a tool until the step cap hits.
      PLAN_WITH_HANDOFF,
      toolCallResponse('c2', 'task_update', { decision: 'working' }),
      toolCallResponse('c3', 'task_update', { decision: 'still working' }),
      // Turn 2 (after the automatic resume): record evidence and complete.
      toolCallResponse('c4', 'task_update', {
        evidence: [{ kind: 'manual', ref: 'reviewed', status: 'pass', acceptance: [1] }],
      }),
      toolCallResponse('c5', 'task_update', { status: 'succeeded' }),
      textResponse('complete'),
    ])
    const { agent } = await harness(adapter, { budget: { maxStepsPerTurn: 3 } })

    ask(agent, 'start')
    await settle(agent)

    const stops = agent.session.snapshotEvents().filter(event => event.type === 'budget/stop')
    expect(stops.length).toBeGreaterThanOrEqual(1)
    expect(resumeAttempts(agent)).toHaveLength(1)
    expect(resumeAttempts(agent)[0]?.data.reason).toMatch(/^budget:/)
  })

  it('does not resume a turn the user cancelled', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'task_update', {
        objective: 'Cancel me',
        acceptance: ['done'],
        handoff: 'Continue',
      }),
      { hangAfter: [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'working' },
      ] },
    ])
    const { agent } = await harness(adapter)

    ask(agent, 'start')
    // Let the task land, then cancel mid-stream.
    await new Promise(resolve => setTimeout(resolve, 20))
    agent.cancel({ kind: 'user' })
    await settle(agent)

    expect(resumeAttempts(agent)).toHaveLength(0)
    const ends = agent.session.snapshotEvents().filter(event => event.type === 'turn/end')
    expect(ends.some(event => event.data.reason.kind === 'aborted')).toBe(true)
  })

  it('does not resume an active task without a handoff', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'task_update', { objective: 'No handoff', acceptance: ['done'] }),
      toolCallResponse('c2', 'task_update', { decision: 'a' }),
      toolCallResponse('c3', 'task_update', { decision: 'b' }),
      textResponse('stopped'),
    ])
    const { ctx, agent } = await harness(adapter, { budget: { maxStepsPerTurn: 3 } })

    ask(agent, 'start')
    await settle(agent)

    expect(latestTask(ctx, agent)?.handoff).toBeUndefined()
    expect(agent.session.snapshotEvents().some(event => event.type === 'budget/stop')).toBe(true)
    expect(resumeAttempts(agent)).toHaveLength(0)
  })

  it('resumes a handoff-less task when the requirement is off', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'task_update', { objective: 'No handoff', acceptance: ['done'] }),
      toolCallResponse('c2', 'task_update', { decision: 'a' }),
      toolCallResponse('c3', 'task_update', { decision: 'b' }),
      textResponse('resumed'),
    ])
    const { agent } = await harness(adapter, {
      budget: { maxStepsPerTurn: 3 },
      autoResume: { requireHandoff: false },
    })

    ask(agent, 'start')
    await settle(agent)

    expect(resumeAttempts(agent).length).toBeGreaterThanOrEqual(1)
  })

  it('stops after the configured attempt limit', async () => {
    const script = [
      toolCallResponse('c1', 'task_update', {
        objective: 'Loop',
        acceptance: ['done'],
        handoff: 'Keep going',
      }),
    ]
    // Every turn burns its step budget on a no-op decision.
    for (let index = 0; index < 12; index++) {
      script.push(toolCallResponse(`d${String(index)}`, 'task_update', { decision: `d${String(index)}` }))
    }
    const adapter = new MockAdapter(script)
    const { agent } = await harness(adapter, {
      budget: { maxStepsPerTurn: 2 },
      autoResume: { maxAutoResumes: 2 },
    })

    ask(agent, 'start')
    await settle(agent)

    expect(resumeAttempts(agent)).toHaveLength(2)
  })

  it('stands down while a goal is armed', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'task_update', {
        objective: 'Goal owns this',
        acceptance: ['done'],
        handoff: 'Continue',
      }),
      toolCallResponse('c2', 'task_update', { decision: 'a' }),
      toolCallResponse('c3', 'task_update', { decision: 'b' }),
      textResponse('stopped'),
    ])
    const { agent } = await harness(adapter, {
      budget: { maxStepsPerTurn: 2 },
      goals: { get: () => ({ activation: 'armed' }) },
    })

    ask(agent, 'start')
    await settle(agent)

    expect(agent.session.snapshotEvents().some(event => event.type === 'budget/stop')).toBe(true)
    expect(resumeAttempts(agent)).toHaveLength(0)
  })

  it('does not resume a turn that completed normally', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'task_update', {
        objective: 'Just finish',
        acceptance: ['done'],
        handoff: 'Continue',
      }),
      textResponse('all done'),
    ])
    const { agent } = await harness(adapter)

    ask(agent, 'start')
    await settle(agent)

    expect(resumeAttempts(agent)).toHaveLength(0)
  })
})

describe('durable attempt accounting', () => {
  it('counts attempts from the session log so a restart cannot reset the budget', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'task_update', {
        objective: 'Resume budget',
        acceptance: ['done'],
        handoff: 'Continue',
      }),
      toolCallResponse('c2', 'task_update', { decision: 'a' }),
      toolCallResponse('c3', 'task_update', { decision: 'b' }),
      textResponse('stopped'),
    ])
    const { agent } = await harness(adapter, {
      budget: { maxStepsPerTurn: 2 },
      autoResume: { maxAutoResumes: 1 },
    })
    // History from a prior process: the session already spent its one attempt.
    agent.session.append('auto-resume/attempt', {
      reason: 'budget:steps', attempt: 1, taskRevision: 0, at: 1,
    }, { ignorable: true })

    ask(agent, 'start')
    await settle(agent)

    // maximum is one, so the pre-existing attempt leaves nothing to spend.
    expect(resumeAttempts(agent)).toHaveLength(1)
  })
})
