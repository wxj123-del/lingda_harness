import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as TaskState from '@deepseek-ai/dsh-task-state'
import type { TaskState as Snapshot } from '@deepseek-ai/dsh-task-state/types'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Mount the real loop with the task plugin and a scripted model. */
async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TaskState, {
    injectTaskCard: true,
    recordCommandEvidence: true,
    requireVerifiedEvidence: true,
  })
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

function findEvents<T extends SessionEvent['type']>(
  log: readonly SessionEvent[],
  type: T,
): Extract<SessionEvent, { type: T }>[] {
  return log.filter((event): event is Extract<SessionEvent, { type: T }> => event.type === type)
}

function latestTask(ctx: Context, agent: Agent): Snapshot | null {
  return ctx.sessionProjections.stateOf(agent.session, 'task') ?? null
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

/** First text block inside a settled tool result's `tool-result` content. */
function resultText(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  const block = event.data.message.content[0]
  if (block?.type !== 'tool-result') return ''
  const first = block.content[0]
  return first?.type === 'text' ? first.text : ''
}

/**
 * A bash fixture whose rendered result ends with the `[exit code: N]` marker the
 * real shell renderer appends, so the log-derived verification path can recover
 * the code exactly as it does in production.
 */
function registerExitMarkedBash(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'fixture',
    parameters: { command: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          exitCode: { type: 'integer', required: true },
        },
      },
      // Mirrors the production shell renderer: the marker appears only for a
      // non-zero exit, so a clean run's text carries no code at all.
      render: (_args, value) => [{
        type: 'text' as const,
        text: value.exitCode === 0 ? 'ok' : `ok\n[exit code: ${String(value.exitCode)}]`,
      }],
    },
    execute: () => Promise.resolve({ kind: 'foreground', exitCode: 0 }),
  }))
}

describe('task_update through the agent loop', () => {
  it('creates a task and returns the uncovered criteria', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'task_update', {
        objective: 'Ship mini-search',
        acceptance: ['tests pass', 'cli works'],
      }),
      textResponse('Task recorded.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-task-create'), { provider: 'mock', model: 'mock' })

    ask(agent, 'plan the work')
    await waitForIdle(ctx, agent)

    const task = latestTask(ctx, agent)
    expect(task?.objective).toBe('Ship mini-search')
    expect(task?.acceptance).toEqual(['tests pass', 'cli works'])
    expect(task?.status).toBe('active')

    const results = findEvents(agent.session.snapshotEvents(), 'tool/result')
    expect(results[0] === undefined ? '' : resultText(results[0])).toContain('"uncovered":[1,2]')
  })

  it('rejects a completion claim without evidence', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'task_update', {
        objective: 'Ship it',
        acceptance: ['tests pass'],
      }),
      toolCallResponse('call-2', 'task_update', { status: 'succeeded' }),
      textResponse('Blocked by the gate.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-task-gate'), { provider: 'mock', model: 'mock' })

    ask(agent, 'finish the work')
    await waitForIdle(ctx, agent)

    expect(latestTask(ctx, agent)?.status).toBe('active')
    const results = findEvents(agent.session.snapshotEvents(), 'tool/result')
    const rejection = results.find(item => item.data.message.content[0]?.isError === true)
    expect(rejection === undefined ? '' : resultText(rejection)).toContain('lack passing evidence')
  })

  it('accepts a completion claim once every criterion has observed evidence', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'task_update', {
        objective: 'Ship it',
        acceptance: ['tests pass'],
      }),
      // The model runs the command, so the shell observer records the result
      // and the completion gate has something observed to rely on.
      toolCallResponse('call-2', 'bash', { command: 'npm test' }),
      toolCallResponse('call-3', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      toolCallResponse('call-4', 'task_update', { status: 'succeeded' }),
      textResponse('Verified and complete.'),
    ])
    const ctx = await harness(adapter)
    registerExitMarkedBash(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-task-pass'), { provider: 'mock', model: 'mock' })

    ask(agent, 'finish the work')
    await waitForIdle(ctx, agent)

    expect(latestTask(ctx, agent)?.status).toBe('succeeded')
  })

  it('rejects a completion claim whose evidence names a command nobody ran', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'task_update', {
        objective: 'Ship it',
        acceptance: ['tests pass'],
      }),
      toolCallResponse('call-2', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      toolCallResponse('call-3', 'task_update', { status: 'succeeded' }),
      textResponse('Cannot claim completion.'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-task-unverified'), { provider: 'mock', model: 'mock' })

    ask(agent, 'finish the work')
    await waitForIdle(ctx, agent)

    expect(latestTask(ctx, agent)?.status).toBe('active')
    const results = findEvents(agent.session.snapshotEvents(), 'tool/result')
    const rejection = results.find(item => item.data.message.content[0]?.isError === true)
    expect(rejection === undefined ? '' : resultText(rejection)).toContain('have only asserted evidence')
  })

  it('injects the card at the first step of each turn and again when the task changes', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'task_update', {
        objective: 'Ship it',
        acceptance: ['tests pass'],
      }),
      textResponse('done planning'),
      toolCallResponse('call-2', 'task_update', { decision: 'Use BM25' }),
      textResponse('done'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('it-task-card'), { provider: 'mock', model: 'mock' })

    ask(agent, 'step one')
    await waitForIdle(ctx, agent)
    ask(agent, 'step two')
    await waitForIdle(ctx, agent)

    const cards = agent.session.snapshotEvents().filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'task-state')
    // Turn 1: the task is created mid-turn, so the next step restates it.
    // Turn 2: the first step restates it, and the decision that follows is
    // another revision, so one more card follows. Three in total, and never a
    // repeat without a change.
    expect(cards).toHaveLength(3)
    const texts = cards.map((card) => {
      const body = card.type === 'user/message' ? card.data.content[0] : undefined
      return body?.type === 'text' ? body.text : ''
    })
    expect(texts[0]).toContain('Objective: Ship it')
    expect(texts.at(-1)).toContain('- Use BM25')
    expect(adapter.requests).toHaveLength(4)
    expect(adapter.requests[2]?.messages.some(message =>
      message.content.some(block => block.type === 'text' && block.text.includes('<task_state>')))).toBe(true)
  })

  it('does not repeat the card across steps when the task did not change', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'task_update', { objective: 'Stable', acceptance: ['a'] }),
      // Two tool calls in the same turn, neither changing the task.
      toolCallResponse('call-2', 'bash', { command: 'true' }),
      toolCallResponse('call-3', 'bash', { command: 'true' }),
      textResponse('done'),
    ])
    const ctx = await harness(adapter)
    registerExitMarkedBash(ctx)
    const agent = await ctx.agentLoop.create(SessionId('it-task-card-stable'), { provider: 'mock', model: 'mock' })

    ask(agent, 'work')
    await waitForIdle(ctx, agent)

    const cards = agent.session.snapshotEvents().filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'task-state')
    // The creation lands in step 1, so step 2 restates it once; the bash calls
    // only add automatic evidence, which is itself a revision, so exactly two
    // further cards appear — never one per step.
    expect(cards.length).toBeLessThanOrEqual(3)
    expect(cards.length).toBeGreaterThanOrEqual(2)
  })

  it('routes a settled bash result into automatic evidence', async () => {
    const ctx = await harness(new MockAdapter([
      toolCallResponse('call-1', 'task_update', {
        objective: 'Run the suite',
        acceptance: ['tests execute'],
      }),
      textResponse('Task ready.'),
      textResponse('Command settled.'),
    ]))
    // A minimal foreground result the observer recognizes: exit code plus the
    // exact command argument.
    ctx.tools.register(defineTool({
      name: 'bash',
      description: 'fixture',
      parameters: {
        command: { type: 'string', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true },
            exitCode: { type: 'integer', required: true },
          },
        },
        render: () => [{ type: 'text' as const, text: 'ok' }],
      },
      execute: () => Promise.resolve({
        kind: 'foreground',
        exitCode: 0,
      }),
    }))
    const agent = await ctx.agentLoop.create(SessionId('it-task-evidence'), { provider: 'mock', model: 'mock' })

    ask(agent, 'set a task')
    await waitForIdle(ctx, agent)
    const direct = await ctx.tools.execute({
      callId: 'direct-1' as never,
      name: 'bash',
      arguments: { command: 'npm test' },
      agent,
      signal: new AbortController().signal,
    })
    expect(direct.isError).toBe(false)

    const task = latestTask(ctx, agent)
    expect(task?.evidence.at(-1)).toMatchObject({
      kind: 'command',
      ref: 'npm test',
      status: 'pass',
      auto: true,
    })
  })
})
