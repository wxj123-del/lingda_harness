/** Browser-test wire examples shared by ledger behavior tests. */
import { createMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionEventMap, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { LlmAttemptId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'

export const usage: TokenUsage = { inputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100,
  outputTokens: 200, reasoningTokens: 50, totalTokens: 1200 }

export function entry<K extends keyof SessionEventMap>(seq: number, type: K, data: SessionEventMap[K], surfaceOp?: SessionEvent['surfaceOp']): SessionEventLikeEntry {
  return { type: 'event', event: { seq: seq as SessionSeq, type, data, time: seq * 100,
    ...(surfaceOp === undefined ? {} : { surfaceOp }) } as SessionEvent }
}

export function message(seq: number, step: number, counters?: TokenUsage): SessionEventLikeEntry {
  return entry(seq, 'assistant/message', { turn: 1, step,
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'audit-model' },
      content: [{ type: 'reasoning', text: 'Think' }, { type: 'text', text: 'Answer' }] }),
    stream: [{ type: 'text-chunks', index: 0, time0: seq * 100 - 50, dt: [], texts: ['Answer'] },
      ...(counters === undefined ? [] : [{ type: 'chunk' as const, time: seq * 100, chunk: { type: 'usage' as const, usage: counters } }])],
    ...(counters === undefined ? {} : { usage: counters }),
  }, 'append')
}

export function fixture(): SessionEventLikeEntry[] {
  return [
    entry(0, 'turn/start', { turn: 1 }),
    entry(1, 'step/start', { turn: 1, step: 1 }),
    entry(2, 'system/message', { turn: 1, step: 1, message: createSystemMessage('You audit requests.', 'fixture') }, 'append'),
    entry(3, 'user/message', createUserMessage({ content: [{ type: 'text', text: 'Inspect the source' }], source: { kind: 'user' } }), 'append'),
    entry(4, 'request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'audit-model' },
      tools: [{ name: 'read', description: 'Read source', parameters: { type: 'object' } }] } }),
    message(5, 1, usage),
    entry(6, 'tool/call', { turn: 1, step: 1, callId: 'read-1' as ToolCallId, name: 'read', arguments: '{"path":"source.ts"}' }),
    entry(7, 'tool/result', { turn: 1, step: 1,
      message: createUserMessage({ source: { kind: 'tool', callId: 'read-1' as ToolCallId }, content: [{ type: 'tool-result', toolCallId: 'read-1' as ToolCallId,
        content: [{ type: 'text', text: 'export const source = 1' }] }] }) as never }, 'append'),
    entry(8, 'step/end', { turn: 1, step: 1 }),
    entry(9, 'step/start', { turn: 1, step: 2 }),
    message(10, 2, { ...usage, inputTokens: 200, totalTokens: 1300 }),
    entry(11, 'step/end', { turn: 1, step: 2 }),
    entry(12, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

export function live(seq: number, text: string): SessionEventLikeEntry {
  return { type: 'transient', event: { type: 'assistant/live-chunk', seq, time: seq * 100,
    data: { attemptId: 'live-1' as LlmAttemptId, turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } } } }
}
