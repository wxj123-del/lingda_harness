import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as TaskState from '@deepseek-ai/dsh-task-state'
import type { Config } from '@deepseek-ai/dsh-task-state'
import type { TaskState as Snapshot } from '@deepseek-ai/dsh-task-state/types'
import { reverifiableCommands } from '../src/state.ts'
import type { ShellFact } from '../src/state.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Exit code the fixture bash tool reports on its next call. */
interface BashFixture {
  exitCode: number
  /** When set, the tool never resolves until the signal aborts. */
  hang?: boolean
  calls: string[]
}

async function harness(adapter: MockAdapter, config: Partial<Config> = {}): Promise<{
  ctx: Context
  agent: Agent
  bash: BashFixture
}> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TaskState, {
    injectTaskCard: true,
    recordCommandEvidence: true,
    requireVerifiedEvidence: true,
    ...config,
  })
  ctx.llm.registerAdapter(['mock'], adapter)

  const bash: BashFixture = { exitCode: 0, calls: [] }
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
      // Production shell renderer: no marker on a clean exit.
      render: (_args, value) => [{
        type: 'text' as const,
        text: value.exitCode === 0 ? 'ok' : `ok\n[exit code: ${String(value.exitCode)}]`,
      }],
    },
    async execute(args, exec) {
      bash.calls.push(args.command)
      if (bash.hang === true) {
        await new Promise<void>((_resolve, reject) => {
          exec.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      }
      return { kind: 'foreground', exitCode: bash.exitCode }
    },
  }))

  const agent = await ctx.agentLoop.create(SessionId(`reverify-${String(Math.random()).slice(2, 8)}`), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, agent, bash }
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function latestTask(ctx: Context, agent: Agent): Snapshot | null {
  return ctx.sessionProjections.stateOf(agent.session, 'task') ?? null
}

function resultTexts(agent: Agent): string[] {
  return agent.session.snapshotEvents()
    .filter((event): event is Extract<SessionEvent, { type: 'tool/result' }> => event.type === 'tool/result')
    .map((event) => {
      const block = event.data.message.content[0]
      if (block?.type !== 'tool-result') return ''
      const first = block.content[0]
      return first?.type === 'text' ? first.text : ''
    })
}

const CREATE = toolCallResponse('c1', 'task_update', {
  objective: 'Ship it',
  acceptance: ['tests pass'],
})

describe('evidence re-verification', () => {
  it('rejects completion when a previously passing command now fails', async () => {
    const { ctx, agent, bash } = await harness(new MockAdapter([
      CREATE,
      toolCallResponse('c2', 'bash', { command: 'npm test' }),
      toolCallResponse('c3', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      textResponse('ready'),
      toolCallResponse('c4', 'task_update', { status: 'succeeded' }),
      textResponse('cannot complete'),
    ]), { reverifyEvidence: true })

    ask(agent, 'work')
    await agent.whenIdle()
    expect(latestTask(ctx, agent)?.status).toBe('active')

    // Flip the world: the same command now fails.
    bash.exitCode = 1
    ask(agent, 'try again')
    await agent.whenIdle()

    expect(latestTask(ctx, agent)?.status).toBe('active')
    expect(resultTexts(agent).some(text => text.includes('TASK_REVERIFY_FAILED')
      || text.includes('is no longer backed by a live pass'))).toBe(true)
  })

  it('accepts completion when the re-run passes, and records it in the log', async () => {
    const { ctx, agent, bash } = await harness(new MockAdapter([
      CREATE,
      toolCallResponse('c2', 'bash', { command: 'npm test' }),
      toolCallResponse('c3', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      toolCallResponse('c4', 'task_update', { status: 'succeeded' }),
      textResponse('done'),
    ]), { reverifyEvidence: true })

    ask(agent, 'work')
    await agent.whenIdle()

    expect(latestTask(ctx, agent)?.status).toBe('succeeded')
    // The first turn ran `npm test` once; completion re-ran it.
    expect(bash.calls.filter(command => command === 'npm test').length).toBe(2)
  })

  it('keeps automatic evidence written by the re-run instead of overwriting it', async () => {
    const { ctx, agent } = await harness(new MockAdapter([
      CREATE,
      toolCallResponse('c2', 'bash', { command: 'npm test' }),
      toolCallResponse('c3', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      toolCallResponse('c4', 'task_update', { status: 'succeeded' }),
      textResponse('done'),
    ]), { reverifyEvidence: true })

    ask(agent, 'work')
    await agent.whenIdle()

    const task = latestTask(ctx, agent)
    expect(task?.status).toBe('succeeded')
    // Create, manual evidence is absent, and each bash run adds an automatic
    // record: the completion re-run must survive the final write.
    expect(task?.evidence.filter(record => record.auto === true).length).toBeGreaterThanOrEqual(2)
    const revisions = agent.session.snapshotEvents()
      .filter(event => event.type === 'task/state')
      .map(event => (event.data.task as Snapshot | null)?.revision ?? 0)
    expect(revisions).toHaveLength(new Set(revisions).size)
    expect(revisions.at(-1)).toBe(task?.revision)
  })

  it('times out one re-verification run without hanging the turn', async () => {
    const { ctx, agent, bash } = await harness(new MockAdapter([
      CREATE,
      toolCallResponse('c2', 'bash', { command: 'npm test' }),
      toolCallResponse('c3', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      textResponse('ready'),
      toolCallResponse('c4', 'task_update', { status: 'succeeded' }),
      textResponse('gave up'),
    ]), { reverifyEvidence: true, reverifyTimeoutMs: 20 })

    ask(agent, 'work')
    await agent.whenIdle()
    bash.hang = true
    ask(agent, 'try again')
    await agent.whenIdle()

    expect(latestTask(ctx, agent)?.status).toBe('active')
    expect(resultTexts(agent).some(text => text.includes('re-verification timed out'))).toBe(true)
  })

  it('refuses to start when the command count exceeds the limit', async () => {
    const acceptance = Array.from({ length: 9 }, (_unused, index) => `criterion ${String(index + 1)}`)
    const evidence = acceptance.map((_text, index) => ({
      kind: 'test' as const,
      ref: `npm test -- suite-${String(index + 1)}`,
      status: 'pass' as const,
      acceptance: [index + 1],
    }))
    const responses = [toolCallResponse('c1', 'task_update', { objective: 'many', acceptance, evidence })]
    // Nine distinct successfully observed commands.
    for (let index = 0; index < 9; index++) {
      responses.push(toolCallResponse(`b${String(index)}`, 'bash', {
        command: `npm test -- suite-${String(index + 1)}`,
      }))
    }
    responses.push(toolCallResponse('c2', 'task_update', { status: 'succeeded' }))
    responses.push(textResponse('cannot complete'))

    const { ctx, agent, bash } = await harness(new MockAdapter(responses), {
      reverifyEvidence: true,
      maxReverifyCommands: 8,
    })
    ask(agent, 'work')
    await agent.whenIdle()

    expect(latestTask(ctx, agent)?.status).toBe('active')
    expect(resultTexts(agent).some(text => text.includes('above the configured limit of 8'))).toBe(true)
    // Nothing re-ran: the nine fixture calls are the originals.
    expect(bash.calls).toHaveLength(9)
  })

  it('leaves behavior unchanged when re-verification is off', async () => {
    const { ctx, agent, bash } = await harness(new MockAdapter([
      CREATE,
      toolCallResponse('c2', 'bash', { command: 'npm test' }),
      toolCallResponse('c3', 'task_update', {
        evidence: [{ kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1] }],
      }),
      toolCallResponse('c4', 'task_update', { status: 'succeeded' }),
      textResponse('done'),
    ]), { reverifyEvidence: false })

    ask(agent, 'work')
    await agent.whenIdle()

    expect(latestTask(ctx, agent)?.status).toBe('succeeded')
    expect(bash.calls).toHaveLength(1)
  })

  it('rejects a configuration that enables re-verification without the strict gate', () => {
    const ctx = new Context()
    expect(() => TaskState.apply(ctx, {
      injectTaskCard: true,
      recordCommandEvidence: true,
      requireVerifiedEvidence: false,
      reverifyEvidence: true,
      reverifyTimeoutMs: 1000,
      maxReverifyCommands: 4,
    } as Config)).toThrow(/reverifyEvidence requires requireVerifiedEvidence/)
  })

  it('skips automatic records that back no criterion', () => {
    const facts: ShellFact[] = [
      { name: 'bash', command: 'ls -la', exitCode: 0 },
      { name: 'bash', command: 'node --test work.test.mjs', exitCode: 0 },
    ]
    const task: Snapshot = {
      revision: 2,
      objective: 'narrow',
      status: 'active',
      acceptance: ['tests pass'],
      evidence: [
        { id: 'e1', kind: 'command', ref: 'ls -la', status: 'pass', acceptance: [], at: 1, auto: true },
        { id: 'e2', kind: 'test', ref: 'node --test work.test.mjs', status: 'pass', acceptance: [1], at: 2 },
      ],
      decisions: [],
      createdAt: 1,
      updatedAt: 2,
    }
    expect(reverifiableCommands(task, facts)).toEqual([
      { name: 'bash', command: 'node --test work.test.mjs' },
    ])
  })

  it('selects distinct, log-backed commands only', () => {
    const facts: ShellFact[] = [
      { name: 'bash', command: 'npm  test', exitCode: 0 },
      { name: 'bash', command: 'npm test', exitCode: 0 },
      { name: 'pwsh', command: 'Get-ChildItem', exitCode: 0 },
      { name: 'bash', command: 'npm run lint', exitCode: 2 },
    ]
    const task: Snapshot = {
      revision: 1,
      objective: 'select',
      status: 'active',
      acceptance: ['a', 'b', 'c'],
      evidence: [
        { id: 'e1', kind: 'test', ref: 'npm test', status: 'pass', acceptance: [1], at: 1 },
        { id: 'e2', kind: 'test', ref: 'npm   test', status: 'pass', acceptance: [2], at: 2 },
        { id: 'e3', kind: 'test', ref: 'npm run lint', status: 'pass', acceptance: [3], at: 3 },
        { id: 'e4', kind: 'manual', ref: 'looked fine', status: 'pass', acceptance: [3], at: 4 },
        { id: 'e5', kind: 'command', ref: 'Get-ChildItem', status: 'pass', acceptance: [3], at: 5 },
      ],
      decisions: [],
      createdAt: 1,
      updatedAt: 5,
    }
    const selected = reverifiableCommands(task, facts)
    expect(selected).toEqual([
      { name: 'bash', command: 'npm  test' },
      { name: 'pwsh', command: 'Get-ChildItem' },
    ])
  })
})
