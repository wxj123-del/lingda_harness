import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as TaskState from '@deepseek-ai/dsh-task-state'
import type { Agent } from '@deepseek-ai/dsh-agent'

const MODEL = 'mock'
const OLD_HISTORY = 'older conversation history '.repeat(120)

/** Scripted model: one text answer per request, plus the summary call. */
class ScriptedAdapter extends LlmAdapter {
  readonly requests: Message[][] = []

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(options: { messages: readonly Message[] }): AsyncIterable<StreamChunk> {
    this.requests.push([...options.messages])
    const summary = options.messages.at(-1)?.content
      .map(block => block.type === 'text' ? block.text : '')
      .some(text => text.includes('compaction engine'))
    const text = summary === true ? '## Primary Request and Intent\n- Keep the task alive' : 'answer'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Compaction engine whose summary is scripted and whose calls are recorded. */
class RecordingCompaction extends BasicCompactionEngine {
  readonly calls: SummarizationInput[] = []
  summary: ContentBlock[] = [{ type: 'text', text: '## Primary Request and Intent\n- Keep the task alive' }]

  override async summarize(input: SummarizationInput): Promise<SummaryResult> {
    this.calls.push(input)
    return { summary: this.summary, provider: MODEL, model: MODEL }
  }
}

async function harness() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(TaskState, { injectTaskCard: true, recordCommandEvidence: false })
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter([MODEL], adapter)
  const compaction = new RecordingCompaction(ctx, { auto: false })
  const agent = await ctx.agentLoop.create(SessionId('compaction-task'), { provider: MODEL, model: MODEL })
  return { ctx, agent, adapter, compaction }
}

function ask(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

describe('task state across compaction', () => {
  it('keeps the objective and acceptance visible after the history is compacted', async () => {
    const { ctx, agent, compaction } = await harness()

    // Turn 1 creates the task.
    ask(agent, '<seed>')
    await agent.whenIdle()
    agent.session.append('task/state', {
      task: {
        revision: 1,
        objective: 'Keep the task alive across compaction',
        status: 'active',
        acceptance: ['survives compaction'],
        evidence: [],
        decisions: [{ text: 'Use a task snapshot', at: Date.now() }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    }, { ignorable: true })

    // Turn 2 adds enough history for a compactable older span.
    ask(agent, OLD_HISTORY)
    await agent.whenIdle()

    const compacted = await compaction.compactNow(agent, new AbortController().signal)
    expect(compacted?.shadowedSeqs.length).toBeGreaterThan(0)
    expect(compaction.calls).toHaveLength(1)

    // The projection is event-sourced, so the task survives the surface
    // replacement that removed the original messages.
    expect(ctx.sessionProjections.stateOf(agent.session, 'task')).toMatchObject({
      objective: 'Keep the task alive across compaction',
      acceptance: ['survives compaction'],
    })
    expect(agent.session.deriveMessages().some(message =>
      message.content.some(block => block.type === 'text' && block.text === OLD_HISTORY))).toBe(false)

    // Turn 3 re-injects the card, so the objective is in the next request even
    // though the conversation that created it is gone.
    ask(agent, 'continue')
    await agent.whenIdle()
    const lastRequest = agent.session.deriveMessages()
    expect(lastRequest.some(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('<task_state>')))).toBe(true)
    const card = lastRequest
      .flatMap(message => message.content)
      .find(block => block.type === 'text' && block.text.includes('<task_state>'))
    expect(card?.type === 'text' ? card.text : '').toContain('Keep the task alive across compaction')
    expect(card?.type === 'text' ? card.text : '').toContain('1. survives compaction [MISSING EVIDENCE]')
  })
})
