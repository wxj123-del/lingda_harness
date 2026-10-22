/**
 * Runs one long-task acceptance scenario in an isolated process and prints one
 * JSON report. The model is scripted, the loop, tools, guards, and projections
 * are real, so a failing report names a harness regression rather than model
 * behaviour.
 */

import { performance } from 'node:perf_hooks'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as AutoResume from '@deepseek-ai/dsh-auto-resume'
import * as BudgetGuard from '@deepseek-ai/dsh-budget-guard'
import * as TaskState from '@deepseek-ai/dsh-task-state'
import type { TaskState as Snapshot } from '@deepseek-ai/dsh-task-state/types'
import { assertBuiltBenchmarkRuntime } from '../support/built-worker.ts'
import { BUDGET_RESUME_MAX_STEPS, MAX_AUTO_RESUMES, SCENARIOS } from './scenarios.ts'
import type { Scenario } from './scenarios.ts'

/** One scenario's outcome, exactly the fields CI judges. */
export interface AcceptanceReport {
  scenario: string
  ok: boolean
  turns: number
  resumes: number
  budgetStops: number
  totalMs: number
  /** Diagnostic detail for a failure; absent when `ok` is true. */
  detail?: string
}

/** Model that replays one scripted reply per request. */
class ScriptedAdapter extends LlmAdapter {
  private index = 0
  constructor(private readonly scenario: Scenario) {
    super()
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    const reply = this.scenario.replies[this.index++]
    if (reply === undefined) {
      // Running past the script is a real finding: something kept driving.
      yield* textResponse('script exhausted')
      return
    }
    if (reply.call === undefined) {
      yield* textResponse(reply.text ?? '')
      return
    }
    const json = JSON.stringify(reply.call.arguments)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: reply.call.id as ToolCallId, name: reply.call.name, argumentsDelta: json }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: reply.call.id as ToolCallId, name: reply.call.name, arguments: json },
    }
    yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

/** Stream one plain text answer. */
function* textResponse(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 20, outputTokens: text.length } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Register the fixture shell: always exits zero and renders the exit marker. */
function registerBash(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Acceptance fixture shell.',
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
      render: (_args, value) => [{
        type: 'text' as const,
        text: `ok\n[exit code: ${String(value.exitCode)}]`,
      }],
    },
    execute: () => Promise.resolve({ kind: 'foreground', exitCode: 0 }),
  }))
}

/** Let every settled follow-up drain before the next observation. */
async function settle(agent: Agent): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await agent.whenIdle()
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Count events of one type in the session log. */
function count<T extends SessionEvent['type']>(agent: Agent, type: T): number {
  return agent.session.snapshotEvents().filter(event => event.type === type).length
}

/** Seed a session whose task exists and whose last turn never closed. */
async function seedCrash(root: string, sessionId: SessionId): Promise<void> {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
    const handle = await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 0,
      cwd: '/bench',
      isSeeded: false,
    }, {})
    try {
      const task: Snapshot = {
        revision: 1,
        objective: 'Ship the acceptance scenario',
        status: 'active',
        acceptance: ['the suite passes'],
        evidence: [],
        decisions: [],
        handoff: 'Run npm test, record it, then complete',
        createdAt: 0,
        updatedAt: 0,
      }
      // A complete first turn whose objective lives in the task, followed by a
      // second turn that opens and never closes: that is the crash shape the
      // repair path closes as `interrupted`.
      const userMessage = createUserMessage({
        content: [{ type: 'text', text: 'start' }],
        source: { kind: 'user' },
      })
      await handle.append([
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'user/message', seq: 1, time: 2, data: userMessage, surfaceOp: 'append' },
        { type: 'task/state', seq: 2, time: 3, data: { task }, ignorable: true },
        { type: 'turn/end', seq: 3, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'turn/start', seq: 4, time: 5, data: { turn: 2 } },
        { type: 'step/start', seq: 5, time: 6, data: { turn: 2, step: 1 } },
      ] as never[])
      await handle.flush()
    } finally {
      await handle.close()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Run one scenario end to end. */
async function run(scenario: Scenario): Promise<AcceptanceReport> {
  const started = performance.now()
  const root = await mkdtemp(join(tmpdir(), 'long-task-acceptance-'))
  const ctx = new Context()
  let agent: Agent | undefined
  let detail: string | undefined
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TaskState, {
      injectTaskCard: true,
      recordCommandEvidence: true,
      requireVerifiedEvidence: true,
      reverifyEvidence: true,
    })
    await ctx.plugin(BudgetGuard, {
      ...scenario.name === 'budget-resume' ? { maxStepsPerTurn: BUDGET_RESUME_MAX_STEPS } : {},
      warnAtRatio: 1,
    })
    await ctx.plugin(AutoResume, {
      maxAutoResumes: MAX_AUTO_RESUMES,
      minIntervalMs: 0,
      requireHandoff: true,
      resumeOnError: false,
    })
    ctx.llm.registerAdapter(['bench'], new ScriptedAdapter(scenario))
    registerBash(ctx)

    const sessionId = SessionId(`acceptance-${scenario.name}`)
    if (scenario.name === 'crash-resume') {
      await seedCrash(root, sessionId)
      const handle = await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: 'bench', model: 'bench' },
      })
      agent = handle.agent
      await settle(agent)
    } else {
      agent = await ctx.agentLoop.create(sessionId, { provider: 'bench', model: 'bench' })
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'start' }],
        source: { kind: 'user' },
      }))
      await settle(agent)
    }

    const task = ctx.sessionProjections.stateOf(agent.session, 'task')
    const turns = count(agent, 'turn/start')
    const resumes = count(agent, 'auto-resume/attempt')
    const budgetStops = count(agent, 'budget/stop')
    if (scenario.completes && (task === null || task === undefined || task.status !== 'succeeded')) {
      detail = `task status ${String(task?.status ?? 'missing')}`
    } else if (turns !== scenario.turns) {
      detail = `turns ${String(turns)} != ${String(scenario.turns)}`
    } else if (resumes !== scenario.resumes) {
      detail = `resumes ${String(resumes)} != ${String(scenario.resumes)}`
    } else if (budgetStops !== scenario.budgetStops) {
      detail = `budgetStops ${String(budgetStops)} != ${String(scenario.budgetStops)}`
    }
    return {
      scenario: scenario.name,
      ok: detail === undefined,
      turns,
      resumes,
      budgetStops,
      totalMs: Math.round(performance.now() - started),
      ...detail === undefined ? {} : { detail },
    }
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

assertBuiltBenchmarkRuntime(import.meta.url, Object.fromEntries([
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-task-state',
  '@deepseek-ai/dsh-budget-guard',
  '@deepseek-ai/dsh-auto-resume',
].map(name => [name, import.meta.resolve(name)])))

const name = process.argv[2]
const scenario = SCENARIOS.find(item => item.name === name)
if (scenario === undefined) {
  throw new Error(`usage: long-task-acceptance.worker.js <${SCENARIOS.map(item => item.name).join('|')}>`)
}
process.stdout.write(`${JSON.stringify(await run(scenario))}\n`)
