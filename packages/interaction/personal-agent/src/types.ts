/** Client-safe vocabulary for personal Agent mode controls and projections. */

export const AGENT_MODES = ['qa', 'research', 'coding', 'execution'] as const
export type AgentMode = typeof AGENT_MODES[number]

export interface ModePolicy {
  /** Mode identifier whose policy is being described. */
  mode: AgentMode
  /** Tool names exposed while this mode is active. */
  visibleTools: readonly string[]
  /** Maximum agent steps allowed for one task. */
  maxSteps: number
  /** Maximum bytes retained from one tool result. */
  maxToolResultBytes: number
  /** Maximum context tokens admitted to one request. */
  maxContextTokens: number
  /** Number of prior conversation turns retained by the mode. */
  historyTurns: number
  /** Whether knowledge retrieval is disabled or explicit-only. */
  knowledgeBase: 'off' | 'explicit'
  /** Whether the mode asks for human approval before gated actions. */
  approval: 'ask' | 'never'
  /** Filesystem sandbox policy used by execution tools. */
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
}

export interface ModeOption {
  value: AgentMode
  name: string
  description: string
  maxSteps: number
  maxContextTokens: number
}

export interface ModeView {
  mode: AgentMode
  policy: ModePolicy
}

export type AgentTaskStatus = 'created' | 'planned' | 'running' | 'waiting-human' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentTaskBudget {
  maxSteps: number
  maxTokens?: number | undefined
  maxDepth?: number | undefined
  maxConcurrent?: number | undefined
  timeoutMs?: number | undefined
}

export interface AgentTaskSnapshot {
  id: string
  goal: string
  status: AgentTaskStatus
  owner: string
  turn: number
  parentTask?: string | undefined
  budget: AgentTaskBudget
  acceptance?: string[] | undefined
  artifacts?: string[] | undefined
  error?: string | undefined
  createdAt: number
  updatedAt: number
}

export interface ToolPolicyAudit {
  name: string
  reason: string
}

export interface AgentModeSettings {
  defaultMode: AgentMode
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable current personal Agent mode. The latest event wins. */
    'agent/mode': { mode: AgentMode }
    /** Informational audit of one bounded request snapshot. */
    'agent/request-context': {
      turn: number
      step: number
      mode: AgentMode
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
    /** Audit of a tool call rejected by the active personal mode policy. */
    'agent/tool-denied': {
      turn: number
      step: number
      name: string
      code: string
      reason: string
    }
    /** Durable task lifecycle event emitted when a turn task is created. */
    'task/created': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after a user goal is captured. */
    'task/planned': AgentTaskSnapshot
    /** Durable task lifecycle event emitted when task execution starts. */
    'task/running': AgentTaskSnapshot
    /** Durable task lifecycle event emitted while human approval is pending. */
    'task/waiting-human': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after successful completion. */
    'task/succeeded': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after a task failure. */
    'task/failed': AgentTaskSnapshot
    /** Durable task lifecycle event emitted after cancellation. */
    'task/cancelled': AgentTaskSnapshot
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    personalAgentMode: { mode: AgentMode; maxSteps: number }
    personalAgentTask: { current: AgentTaskSnapshot | null }
  }
  interface SessionProjectionMap {
    personalAgentMode: { mode: AgentMode; maxSteps: number }
    personalAgentTask: AgentTaskSnapshot | null
  }
}
