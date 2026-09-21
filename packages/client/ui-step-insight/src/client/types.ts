/** Browser-local ledger values derived from the loaded Session event window. */
import type { SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { GitCheckpoint, GitCommitAudit, GitSyncState } from '@deepseek-ai/dsh-git-workspace'

export type { GitCheckpoint, GitCommitAudit, GitSyncState }

/** Missing counters remain null, including unreported cache buckets. */
export interface Usage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
  prompt: number | null
  total: number | null
  unclassified: number | null
  minimumPrompt: number | null
  minimumTotal: number | null
}

/** One model attempt; retries retain separate records and accounting. */
export interface StepRow {
  id: string
  turn: number | null
  step: number
  attempt: number
  kind: 'assistant' | 'compaction'
  seq: number
  endSeq?: number
  inputBeforeSeq: number
  startTime: number | null
  endTime: number | null
  firstTokenTime: number | null
  provider?: string
  model?: string
  status: 'waiting' | 'streaming' | 'complete' | 'attempt' | 'interrupted' | 'error' | 'unreported'
  usage: Usage
  rawUsage?: TokenUsage | undefined
  output: readonly ContentBlock[]
  tools: ToolRow[]
  evidence: number[]
  error?: string | undefined
  context?: RequestContextAudit | undefined
  /** Read-only workspace snapshots captured around this turn. */
  gitCheckpoints?: GitCheckpointAudit[] | undefined
  toolSelectionReasons?: ToolSelectionReason[] | undefined
  knowledgeRetrieval?: KnowledgeRetrievalAudit[] | undefined
  blockedTools?: ToolDeniedAudit[] | undefined
}

/** Durable audit emitted after the personal Agent bounds a request snapshot. */
export interface RequestContextAudit {
  mode: 'qa' | 'research' | 'coding' | 'execution'
  maxSteps: number
  usedSteps: number
  inputMessages: number
  outputMessages: number
  clippedToolResults: number
  droppedMessages: number
  systemPromptTokens?: number
  toolSchemaTokens?: number
  historyTokens?: number
  knowledgeBaseTokens?: number
  skillTokens?: number
  toolResultTokens?: number
  estimatedInputTokens?: number
  outputBudgetTokens?: number
  deduplicatedMessages?: number
  hiddenTools?: ToolPolicyAudit[]
}

export interface ToolPolicyAudit {
  name: string
  reason: string
}

export interface ToolSelectionReason {
  name: string
  reason: string
}

export interface KnowledgeRetrievalAudit {
  query: string
  turn: number
  step: number
  baseIds: string[]
  status: 'completed' | 'failed'
  hits: number
  skippedBases: string[]
  deduplicatedHits: number
  estimatedTokens: number
  similarityThreshold?: number
  maxResultTokens?: number
  sources?: KnowledgeRetrievalSource[]
  error?: string
}

export interface KnowledgeRetrievalSource {
  baseId: string
  baseTitle: string
  documentId: string
  documentTitle: string
  ordinal: number
  score: number
}

export interface ToolDeniedAudit {
  turn: number
  step: number
  name: string
  code: string
  reason: string
}

/** Durable, bounded Git status/diff audit for a coding task. */
export type GitCheckpointAudit = GitCheckpoint

/** A tool operation is not an additional provider token charge. */
export interface ToolRow {
  id: string
  name: string
  seq: number
  endSeq?: number
  parentId?: string
  arguments: string
  result: readonly ContentBlock[] | null
  startTime: number | null
  endTime: number | null
  isError: boolean
}

/** One inspectable part of the input, priced only with a labelled text heuristic. */
export interface InputPart {
  id: string
  seq: number
  kind: 'system' | 'schema' | 'user' | 'context' | 'assistant' | 'tool' | 'unknown'
  source: string
  text: string
  tokens: number
  media: boolean
  /** User text blocks only; excludes serialized media and attachment metadata. */
  userText?: string
  schema?: { name: string; description: string }
}

/** Local lexical comparison, separate from provider accounting and tool execution. */
export interface ToolSimilarity {
  part: InputPart
  score: number | null
  matches: { query: string; tool: string }[]
}

/** Registration-private Session feed and history paging. */
export interface StepInsightInjected {
  hooks: { ledgerEvents: SessionEventSource }
  loadOlder(): Promise<void>
}
