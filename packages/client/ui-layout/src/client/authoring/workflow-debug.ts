/** Browser-safe lifecycle events used by the workflow debug dock. */
export type WorkflowDebugEvent =
  | { kind: 'start'; runId: string; workflowName: string; at: number }
  | { kind: 'phase'; runId: string; workflowName: string; title: string; at: number }
  | { kind: 'log'; runId: string; workflowName: string; message: string; at: number }
  | { kind: 'agent-start'; runId: string; workflowName: string; seq: number; label: string; phase?: string; at: number }
  | { kind: 'agent-end'; runId: string; workflowName: string; seq: number; label: string; outcome: 'completed' | 'failed' | 'cancelled'; at: number }
  | { kind: 'node-start'; runId: string; workflowName: string; nodeId: string; label: string; retryCount: number; at: number }
  | { kind: 'node-end'; runId: string; workflowName: string; nodeId: string; label: string; status: 'completed' | 'failed' | 'skipped' | 'blocked' | 'cancelled'; durationMs: number; error?: string; at: number }
  | { kind: 'end'; runId: string; workflowName: string; stopReason: 'completed' | 'cancelled' | 'error'; error?: string; agentsStarted: number; at: number }

export interface WorkflowRunView {
  runId: string
  workflowId: string
  workflowVersion?: number
  name: string
  status: 'running' | 'completed' | 'cancelled' | 'error'
  startedAt: number
  endedAt?: number
  agentsStarted: number
  error?: string
  value?: unknown
  timedOut?: boolean
  source?: 'visual-editor' | 'schedule'
  inputBytes?: number
  timeoutMs?: number
  audit?: readonly WorkflowNodeAuditView[]
}

export interface WorkflowNodeAuditView {
  correlationId: string
  nodeId: string
  label: string
  status: 'running' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'cancelled'
  startedAt: number
  endedAt?: number
  durationMs?: number
  retryCount: number
  inputSummary?: string
  outputSummary?: string
  error?: string
}

export type WorkflowRunInputMode = 'text' | 'json'

/** Input supplied by the editor when starting a direct workflow run. */
export interface WorkflowRunInput {
  readonly text: string
  readonly mode: WorkflowRunInputMode
  readonly timeoutMs?: number
}

/** Immediate acknowledgement returned by the Host before execution settles. */
export interface WorkflowRunStart {
  readonly runId: string
  readonly status: 'running'
  readonly startedAt: number
}

export type WorkflowRunStartHandler = (item: import('../../authoring-settings.ts').AuthoringItem, input?: WorkflowRunInput) => Promise<WorkflowRunStart | void>

/** Optional controls used by the editor for polling, cancellation, and history. */
export interface WorkflowRunControls {
  readonly cancel?: (runId: string) => Promise<void>
  readonly status?: (runId: string) => Promise<WorkflowRunView | undefined>
  readonly list?: (workflowId: string) => Promise<readonly WorkflowRunView[]>
}

/** Timing and input selected when creating one published workflow trigger. */
export interface WorkflowScheduleInput {
  readonly kind: 'at' | 'every'
  readonly at?: string
  readonly everySeconds?: number
  readonly input: WorkflowRunInput
}

/** Active workflow trigger projected from the owning Session's durable log. */
export interface WorkflowScheduleView {
  readonly id: string
  readonly kind: 'at' | 'every'
  readonly scheduledAt: string
  readonly everySeconds?: number
  readonly workflowVersion: number
}

/** Direct Host controls for published workflow triggers. */
export interface WorkflowScheduleControls {
  readonly create: (item: import('../../authoring-settings.ts').AuthoringItem, input: WorkflowScheduleInput) => Promise<WorkflowScheduleView>
  readonly list: (workflowId: string) => Promise<readonly WorkflowScheduleView[]>
  readonly delete: (id: string) => Promise<void>
}

/** Redacted Host credential metadata exposed to the workflow editor. */
export interface WorkflowCredentialInfo {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/** Write-only credential operations used by tool and HTTP workflow nodes. */
export interface WorkflowCredentialControls {
  readonly describe: (ref: string) => Promise<WorkflowCredentialInfo>
  readonly set: (ref: string, value: string) => Promise<void>
  readonly unset: (ref: string) => Promise<void>
  readonly subscribe?: (listener: (ref: string) => void) => () => void
}

export type WorkflowDebugListener = (event: WorkflowDebugEvent) => void
export type SubscribeWorkflowDebug = (listener: WorkflowDebugListener) => () => void

export function workflowRuntimeName(id: string): string {
  const stableId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-workflow'
  return `ui-${stableId}`
}
