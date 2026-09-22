/** Read-only accounting over ordinary requests, retries, live chunks and compactions. */
import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  assembleAssistantStream, assistantStreamFirstTokenTime, isTokenDelta,
} from '@deepseek-ai/dsh-llm/assistant-stream'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type {} from '@deepseek-ai/dsh-host-knowledge'
import type {} from '@deepseek-ai/dsh-personal-agent'
import type {} from '@deepseek-ai/dsh-git-workspace'
import type {} from '@deepseek-ai/dsh-context-router'
import type {} from '@deepseek-ai/dsh-tools/types'
import type { GitCheckpointAudit, KnowledgeRetrievalAudit, StepRow, ToolDeniedAudit, ToolRow, ToolSelectionReason } from './types.ts'
import { readUsage } from './usage.ts'

function account(row: StepRow, value: TokenUsage | undefined): void {
  row.rawUsage = value
  row.usage = readUsage(value)
}

function visibleBlocks(stream: ReturnType<typeof assembleAssistantStream>) {
  try {
    return stream.blocks()
  } catch {
    // Media blocks can remain open between chunks or when an attempt fails.
    return stream.interruptedBlocks()
  }
}

/**
 * Derive one row per attempt without adding tool estimates to provider totals.
 * @param entries - authoritative loaded Session window; settlements replace live chunks.
 * @returns Chronological rows with source event sequence numbers.
 */
export function deriveSteps(entries: readonly SessionEventLikeEntry[]): StepRow[] {
  return createAccumulator()(entries)
}

/**
 * Reuse request assembly between consecutive window revisions.
 * @returns A window reader that folds append deltas and rebuilds after history changes.
 */
export function createStepReader(): (window: SessionEventWindow) => StepRow[] {
  let previous: SessionEventWindow | undefined
  let fold = createAccumulator()
  let rows: StepRow[] = []
  return (window) => {
    if (window === previous) return rows
    if (previous !== undefined && window.revision === previous.revision + 1 && window.change.kind === 'append') {
      rows = fold(window.change.entries)
    } else {
      fold = createAccumulator()
      rows = fold(window.entries)
    }
    previous = window
    return rows
  }
}

function createAccumulator() {
  const rows: StepRow[] = []
  const steps = new Map<string, StepRow>()
  const tools = new Map<string, { row: StepRow; tool: ToolRow }>()
  const compactions = new Map<string, StepRow>()
  const checkpoints = new Map<number, GitCheckpointAudit[]>()
  const retrievals = new Map<number, KnowledgeRetrievalAudit[]>()
  const denials = new Map<number, ToolDeniedAudit[]>()
  const streams = new Map<string, ReturnType<typeof assembleAssistantStream>>()
  let route: { provider?: string; model?: string } = {}
  const keyOf = (turn: number | null, step: number) => `${turn}:${step}`
  const create = (turn: number | null, step: number, seq: number, time: number | null, kind: StepRow['kind'] = 'assistant'): StepRow => {
    const previous = steps.get(keyOf(turn, step))
    const row: StepRow = {
      id: `${kind}:${seq}`, kind, turn, step, seq, inputBeforeSeq: Infinity,
      attempt: kind === 'assistant' ? (previous?.attempt ?? 0) + 1 : 1,
      startTime: time, endTime: null, firstTokenTime: null,
      status: 'waiting', usage: readUsage(), output: [], tools: [], evidence: [seq], ...route,
    }
    if (turn !== null) row.gitCheckpoints = checkpoints.get(turn)
    if (turn !== null) {
      row.knowledgeRetrieval = retrievals.get(turn)
      row.blockedTools = denials.get(turn)
    }
    rows.push(row)
    if (kind === 'assistant') steps.set(keyOf(turn, step), row)
    return row
  }
  const active = (turn: number, step: number, seq: number): StepRow => {
    const previous = steps.get(keyOf(turn, step))
    return previous !== undefined && (previous.status === 'waiting' || previous.status === 'streaming')
      ? previous : create(turn, step, seq, null)
  }
  const toolOwner = (turn: number, step: number, seq: number): StepRow => {
    const previous = steps.get(keyOf(turn, step))
    if (previous !== undefined) return previous
    const row = create(turn, step, seq, null)
    row.status = 'unreported'
    row.inputBeforeSeq = seq
    return row
  }
  return (entries: readonly SessionEventLikeEntry[]): StepRow[] => {
    for (const { event } of entries) {
      switch (event.type) {
        case 'agent/git-checkpoint': {
          const audit: GitCheckpointAudit = event.data
          const list = checkpoints.get(audit.turn) ?? []
          list.push(audit)
          checkpoints.set(audit.turn, list)
          for (const row of rows) {
            if (row.turn === audit.turn) row.gitCheckpoints = [...list]
          }
          break
        }
        case 'request/header':
          route = event.data.header.config
          for (const row of rows) {
            if (row.status === 'waiting') Object.assign(row, route)
          }
          break
        case 'agent/request-context': {
          const row = active(event.data.turn, event.data.step, event.seq)
          row.context = event.data
          row.evidence.push(event.seq)
          break
        }
        case 'context/router': {
          const row = active(event.data.turn, event.data.step, event.seq)
          row.contextRoute = event.data
          row.evidence.push(event.seq)
          break
        }
        case 'agent/tool-denied': {
          const list = denials.get(event.data.turn) ?? []
          list.push(event.data)
          denials.set(event.data.turn, list)
          for (const row of rows) if (row.turn === event.data.turn) row.blockedTools = [...list]
          break
        }
        case 'task/created':
        case 'task/planned':
        case 'task/running':
        case 'task/waiting-human':
        case 'task/succeeded':
        case 'task/failed':
        case 'task/cancelled':
          break
        case 'knowledge/retrieval': {
          const audit = (event as unknown as { data: KnowledgeRetrievalAudit & { turn: number } }).data
          const list = retrievals.get(audit.turn) ?? []
          list.push(audit)
          retrievals.set(audit.turn, list)
          for (const row of rows) if (row.turn === audit.turn) row.knowledgeRetrieval = [...list]
          break
        }
        case 'step/start':
          create(event.data.turn, event.data.step, event.seq, event.time)
          break
        case 'assistant/live-chunk': {
          const { turn, step, attemptId, chunk } = event.data
          const row = active(turn, step, event.seq)
          row.inputBeforeSeq = Math.min(row.inputBeforeSeq, event.seq)
          Object.assign(row, route)
          let stream = streams.get(attemptId)
          if (stream === undefined) {
            stream = assembleAssistantStream([])
            streams.set(attemptId, stream)
          }
          stream.push(chunk)
          row.output = visibleBlocks(stream)
          row.status = 'streaming'
          if (row.firstTokenTime === null && isTokenDelta(chunk)) {
            row.firstTokenTime = event.time
          }
          account(row, stream.usage)
          break
        }
        case 'assistant/message':
        case 'assistant/attempt': {
          const { turn, step, stream } = event.data
          const row = active(turn, step, event.seq)
          Object.assign(row, route)
          const assembled = assembleAssistantStream(stream)
          row.inputBeforeSeq = Math.min(row.inputBeforeSeq, event.seq)
          row.endSeq = event.seq
          row.endTime = event.time
          row.firstTokenTime = assistantStreamFirstTokenTime(stream) ?? null
          row.evidence.push(event.seq)
          row.output = event.type === 'assistant/message' ? event.data.message.content : visibleBlocks(assembled)
          row.status = event.type === 'assistant/attempt' ? 'attempt' : event.data.interrupted ? 'interrupted' : 'complete'
          if (event.type === 'assistant/message') {
            row.provider = event.data.message.source.provider
            row.model = event.data.message.source.model
          }
          account(row, event.type === 'assistant/message' ? event.data.usage ?? assembled.usage : assembled.usage)
          break
        }
        case 'tool/call': {
          const { turn, step, callId, name, arguments: args } = event.data
          const row = toolOwner(turn, step, event.seq)
          const tool: ToolRow = { id: callId, name, seq: event.seq, arguments: args,
            result: null, startTime: event.time, endTime: null, isError: false }
          row.tools.push(tool)
          row.evidence.push(event.seq)
          tools.set(callId, { row, tool })
          break
        }
        case 'tool/result': {
          const { turn, step, message } = event.data
          for (const block of message.content) {
            let owner = tools.get(block.toolCallId)
            if (owner === undefined) {
              const row = toolOwner(turn, step, event.seq)
              const tool: ToolRow = { id: block.toolCallId, name: block.toolCallId, seq: event.seq,
                arguments: '', result: null, startTime: null, endTime: null, isError: false }
              row.tools.push(tool)
              owner = { row, tool }
              tools.set(block.toolCallId, owner)
            }
            Object.assign(owner.tool, { result: block.content, isError: block.isError === true, endSeq: event.seq, endTime: event.time })
            owner.row.evidence.push(event.seq)
          }
          const meta = event.data.meta
          if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) {
            const reasons = meta['toolDiscoveryReasons']
            if (Array.isArray(reasons)) {
              const parsed: ToolSelectionReason[] = reasons.flatMap((value) => {
                if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
                const item = value as { name?: unknown; reason?: unknown }
                return typeof item.name === 'string' && typeof item.reason === 'string'
                  ? [{ name: item.name, reason: item.reason }]
                  : []
              })
              if (parsed.length > 0) {
                const row = toolOwner(turn, step, event.seq)
                row.toolSelectionReasons = [...(row.toolSelectionReasons ?? []), ...parsed]
              }
            }
          }
          break
        }
        case 'tool/ptc-dispatch-start':
        case 'tool/ptc-dispatch': {
          const { rootCallId, parentCallId, subCallId, name, arguments: args } = event.data
          const root = tools.get(rootCallId)
          if (root === undefined) break
          let owner = tools.get(subCallId)
          if (owner === undefined) {
            const tool: ToolRow = { id: subCallId, parentId: parentCallId, name, seq: event.seq,
              arguments: JSON.stringify(args), result: null, startTime: event.time, endTime: null, isError: false }
            root.row.tools.push(tool)
            owner = { row: root.row, tool }
            tools.set(subCallId, owner)
          }
          if (event.type === 'tool/ptc-dispatch') {
            Object.assign(owner.tool, { result: event.data.content, isError: event.data.isError, endSeq: event.seq, endTime: event.time })
          }
          root.row.evidence.push(event.seq)
          break
        }
        case 'compaction/start': {
          const row = create(event.data.turn, 0, event.seq, event.time, 'compaction')
          row.inputBeforeSeq = event.seq
          compactions.set(event.data.compactionId, row)
          break
        }
        case 'compaction/summary': {
          const row = compactions.get(event.data.compactionId) ?? create(null, 0, event.seq, null, 'compaction')
          compactions.set(event.data.compactionId, row)
          row.provider = event.data.provider
          row.model = event.data.model
          row.output = event.data.rawOutput ?? event.data.summary
          row.endTime = event.time
          row.endSeq = event.seq
          row.status = 'complete'
          row.evidence.push(event.seq)
          account(row, event.data.usage)
          break
        }
        case 'compaction/end': {
          const row = compactions.get(event.data.compactionId)
          if (row === undefined) break
          row.endTime = event.time
          row.endSeq = event.seq
          row.error = event.data.error
          row.status = row.error === undefined ? 'complete' : 'error'
          row.evidence.push(event.seq)
          break
        }
        case 'step/end':
        case 'turn/end':
          for (const row of rows) {
            if (row.turn !== event.data.turn || (event.type === 'step/end' && row.step !== event.data.step)) continue
            if (row.status === 'waiting' || row.status === 'streaming') {
              row.status = 'interrupted'
              row.endTime = event.time
              row.inputBeforeSeq = Math.min(row.inputBeforeSeq, event.seq)
            }
            if (event.type === 'turn/end' && event.data.reason.kind === 'error'
            && (row.status === 'attempt' || row.status === 'interrupted')) {
              row.status = 'error'
              row.error = event.data.reason.error.message
            }
          }
          break
        default:
        // Other plugin events carry no provider accounting owned by this ledger.
          break
      }
    }
    // Detach published rows: subsequent chunks must not mutate earlier snapshots.
    return rows.map(row => ({ ...row, evidence: [...row.evidence], tools: row.tools.map(tool => ({ ...tool })) }))
  }
}
