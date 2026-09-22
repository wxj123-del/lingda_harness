/** Browser-safe lifecycle events used by the workflow debug dock. */
export type WorkflowDebugEvent =
  | { kind: 'start'; runId: string; workflowName: string; at: number }
  | { kind: 'phase'; runId: string; workflowName: string; title: string; at: number }
  | { kind: 'log'; runId: string; workflowName: string; message: string; at: number }
  | { kind: 'agent-start'; runId: string; workflowName: string; seq: number; label: string; phase?: string; at: number }
  | { kind: 'agent-end'; runId: string; workflowName: string; seq: number; label: string; outcome: 'completed' | 'failed' | 'cancelled'; at: number }
  | { kind: 'end'; runId: string; workflowName: string; stopReason: 'completed' | 'cancelled' | 'error'; error?: string; agentsStarted: number; at: number }

export type WorkflowDebugListener = (event: WorkflowDebugEvent) => void
export type SubscribeWorkflowDebug = (listener: WorkflowDebugListener) => () => void

export function workflowRuntimeName(id: string): string {
  const stableId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-workflow'
  return `ui-${stableId}`
}
