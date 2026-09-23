import type { WorkflowEdge, WorkflowNode } from './authoring-settings.ts'

/** Structural graph diagnostics shared by the editor and the runtime compiler. */
export type WorkflowGraphIssueCode =
  | 'node-limit'
  | 'edge-limit'
  | 'node-id'
  | 'duplicate-node-id'
  | 'node-title'
  | 'tool-config'
  | 'http-config'
  | 'credential'
  | 'retries'
  | 'start-count'
  | 'end-count'
  | 'edge-id'
  | 'duplicate-edge-id'
  | 'edge-reference'
  | 'self-edge'
  | 'duplicate-edge'
  | 'edge-handle'
  | 'start-incoming'
  | 'end-outgoing'
  | 'unreachable'
  | 'dead-end'
  | 'duplicate-branch'
  | 'cycle'

export interface WorkflowGraphIssue {
  readonly code: WorkflowGraphIssueCode
  readonly nodeId?: string
  readonly edgeId?: string
}

export interface WorkflowGraphAnalysis {
  readonly issues: readonly WorkflowGraphIssue[]
  readonly startId?: string
  readonly endId?: string
  readonly byId: ReadonlyMap<string, WorkflowNode>
  readonly outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>
  readonly incoming: ReadonlyMap<string, readonly WorkflowEdge[]>
  readonly order: readonly string[]
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const CREDENTIAL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function pushIssue(issues: WorkflowGraphIssue[], issue: WorkflowGraphIssue): void {
  const key = `${issue.code}:${issue.nodeId ?? ''}:${issue.edgeId ?? ''}`
  if (!issues.some(existing => `${existing.code}:${existing.nodeId ?? ''}:${existing.edgeId ?? ''}` === key)) issues.push(issue)
}

/** Analyze one visual workflow graph using the same contract required by compilation. */
export function analyzeWorkflowGraph(
  nodes: readonly WorkflowNode[] | undefined,
  edges: readonly WorkflowEdge[] | undefined,
): WorkflowGraphAnalysis {
  const issues: WorkflowGraphIssue[] = []
  const safeNodes = nodes ?? []
  const safeEdges = edges ?? []
  const byId = new Map<string, WorkflowNode>()
  if (safeNodes.length === 0 || safeNodes.length > 200) pushIssue(issues, { code: 'node-limit' })
  if (safeEdges.length > 500) pushIssue(issues, { code: 'edge-limit' })

  for (const node of safeNodes) {
    if (!node.id || node.id.length > 120) pushIssue(issues, { code: 'node-id', nodeId: node.id })
    else if (byId.has(node.id)) pushIssue(issues, { code: 'duplicate-node-id', nodeId: node.id })
    else byId.set(node.id, node)
    if (node.title.trim() === '') pushIssue(issues, { code: 'node-title', nodeId: node.id })
    if (node.kind === 'tool' && !node.config?.tool?.trim()) pushIssue(issues, { code: 'tool-config', nodeId: node.id })
    if (node.kind === 'http') {
      const method = node.config?.method?.trim().toUpperCase() || 'GET'
      if (!node.config?.url?.trim() || !HTTP_METHODS.has(method)) pushIssue(issues, { code: 'http-config', nodeId: node.id })
    }
    if ((node.kind === 'tool' || node.kind === 'http') && node.config?.credential?.trim() !== undefined
      && node.config.credential.trim() !== '' && !CREDENTIAL_PATTERN.test(node.config.credential.trim())) {
      pushIssue(issues, { code: 'credential', nodeId: node.id })
    }
    if (node.config?.retries !== undefined
      && (!Number.isSafeInteger(node.config.retries) || node.config.retries < 0 || node.config.retries > 5)) {
      pushIssue(issues, { code: 'retries', nodeId: node.id })
    }
  }

  const starts = safeNodes.filter(node => node.kind === 'start')
  const ends = safeNodes.filter(node => node.kind === 'end')
  if (starts.length !== 1) pushIssue(issues, { code: 'start-count' })
  if (ends.length !== 1) pushIssue(issues, { code: 'end-count' })
  const start = starts[0]
  const end = ends[0]
  const outgoing = new Map<string, WorkflowEdge[]>()
  const incoming = new Map<string, WorkflowEdge[]>()
  const edgeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  for (const edge of safeEdges) {
    if (!edge.id || edge.id.length > 160) pushIssue(issues, { code: 'edge-id', edgeId: edge.id })
    else if (edgeIds.has(edge.id)) pushIssue(issues, { code: 'duplicate-edge-id', edgeId: edge.id })
    edgeIds.add(edge.id)
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (source === undefined || target === undefined) {
      pushIssue(issues, { code: 'edge-reference', edgeId: edge.id })
      continue
    }
    if (edge.source === edge.target) pushIssue(issues, { code: 'self-edge', edgeId: edge.id })
    const edgeKey = `${edge.source}\u0000${edge.target}\u0000${edge.sourceHandle ?? ''}`
    if (edgeKeys.has(edgeKey)) pushIssue(issues, { code: 'duplicate-edge', edgeId: edge.id })
    edgeKeys.add(edgeKey)
    if (edge.sourceHandle !== undefined && source.kind !== 'condition') pushIssue(issues, { code: 'edge-handle', edgeId: edge.id })
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge])
  }

  if (start !== undefined && (incoming.get(start.id) ?? []).length > 0) pushIssue(issues, { code: 'start-incoming', nodeId: start.id })
  if (end !== undefined && (outgoing.get(end.id) ?? []).length > 0) pushIssue(issues, { code: 'end-outgoing', nodeId: end.id })

  for (const node of safeNodes.filter(candidate => candidate.kind === 'condition')) {
    const branches = new Set<string>()
    for (const edge of outgoing.get(node.id) ?? []) {
      if (edge.sourceHandle === undefined) continue
      if (branches.has(edge.sourceHandle)) pushIssue(issues, { code: 'duplicate-branch', nodeId: node.id })
      branches.add(edge.sourceHandle)
    }
  }

  const reachable = new Set<string>()
  if (start !== undefined && byId.has(start.id)) {
    reachable.add(start.id)
    const queue = [start.id]
    for (const id of queue) {
      for (const edge of outgoing.get(id) ?? []) {
        if (byId.has(edge.target) && !reachable.has(edge.target)) {
          reachable.add(edge.target)
          queue.push(edge.target)
        }
      }
    }
    for (const node of safeNodes) if (!reachable.has(node.id)) pushIssue(issues, { code: 'unreachable', nodeId: node.id })
  }
  const canReachEnd = new Set<string>()
  if (end !== undefined && byId.has(end.id)) {
    canReachEnd.add(end.id)
    const queue = [end.id]
    for (const id of queue) {
      for (const edge of incoming.get(id) ?? []) {
        if (byId.has(edge.source) && !canReachEnd.has(edge.source)) {
          canReachEnd.add(edge.source)
          queue.push(edge.source)
        }
      }
    }
    for (const node of safeNodes) if (!canReachEnd.has(node.id)) pushIssue(issues, { code: 'dead-end', nodeId: node.id })
  }

  // Kahn order supplies the compiler's stable node order for valid graphs.
  const indegree = new Map<string, number>([...reachable].map(id => [id, 0]))
  for (const edge of safeEdges) {
    if (reachable.has(edge.source) && reachable.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const order: string[] = []
  const ready = start !== undefined && reachable.has(start.id) ? [start.id] : []
  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) break
    if (order.includes(id)) continue
    order.push(id)
    for (const edge of outgoing.get(id) ?? []) {
      if (!reachable.has(edge.target)) continue
      const next = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, next)
      if (next === 0) ready.push(edge.target)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const cycle = (outgoing.get(id) ?? []).some(edge => reachable.has(edge.target) && visit(edge.target))
    visiting.delete(id)
    visited.add(id)
    return cycle
  }
  if ([...reachable].some(visit)) pushIssue(issues, { code: 'cycle' })

  return {
    issues,
    ...(start === undefined ? {} : { startId: start.id }),
    ...(end === undefined ? {} : { endId: end.id }),
    byId,
    outgoing,
    incoming,
    order,
  }
}
