import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { AuthoringItem, WorkflowEdge, WorkflowNode, WorkflowViewport } from './authoring-settings.ts'

/** Versioned interchange envelope for workflows exported from the authoring console. */
export interface WorkflowExportDocument {
  readonly kind: 'dsh-workflow'
  readonly schemaVersion: 1
  readonly exportedAt: string
  readonly workflow: {
    readonly title: string
    readonly description: string
    readonly body: string
    readonly steps: readonly string[]
    readonly nodes: readonly WorkflowNode[]
    readonly edges: readonly WorkflowEdge[]
    readonly viewport?: WorkflowViewport | null
  }
}

export type WorkflowExportFormat = 'json' | 'yaml'

const MAX_IMPORT_BYTES = 1024 * 1024
const MAX_NODES = 200
const MAX_EDGES = 500
const NODE_KINDS = new Set<WorkflowNode['kind']>([
  'start', 'input', 'llm', 'tool', 'knowledge', 'condition', 'code', 'http', 'template', 'output', 'end',
])

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Workflow export must be an object')
  return value as Record<string, unknown>
}

function stringField(value: unknown, field: string, required = true): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new Error(`Workflow export field "${field}" must be a string`)
  return value
}

function parseNode(value: unknown): WorkflowNode {
  const raw = record(value)
  const kind = stringField(raw.kind, 'kind') as WorkflowNode['kind']
  if (!NODE_KINDS.has(kind)) throw new Error(`Workflow export contains unsupported node kind "${kind}"`)
  const x = raw.x
  const y = raw.y
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new Error('Workflow node positions must be finite numbers')
  }
  const config = raw.config
  let normalizedConfig: WorkflowNode['config'] | undefined
  if (config !== undefined) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new Error('Workflow node config must be an object')
    const source = config as Record<string, unknown>
    const fields = ['model', 'tool', 'condition', 'output', 'variable', 'credential', 'knowledge', 'format', 'language', 'url', 'method', 'template'] as const
    const next: NonNullable<WorkflowNode['config']> = {}
    for (const field of fields) {
      if (source[field] === undefined) continue
      if (typeof source[field] !== 'string') throw new Error(`Workflow node config field "${field}" must be a string`)
      next[field] = source[field]
    }
    if (source.retries !== undefined) {
      if (typeof source.retries !== 'number' || !Number.isSafeInteger(source.retries) || source.retries < 0 || source.retries > 5) throw new Error('Workflow node retries must be an integer from 0 to 5')
      next.retries = source.retries
    }
    normalizedConfig = next
  }
  return {
    id: stringField(raw.id, 'node.id'),
    kind,
    title: stringField(raw.title, 'node.title'),
    instructions: stringField(raw.instructions, 'node.instructions', false),
    ...(normalizedConfig === undefined ? {} : { config: normalizedConfig }),
    x,
    y,
  }
}

function parseEdge(value: unknown): WorkflowEdge {
  const raw = record(value)
  const sourceHandle = raw.sourceHandle
  if (sourceHandle !== undefined && sourceHandle !== 'true' && sourceHandle !== 'false') {
    throw new Error('Workflow edge sourceHandle must be true or false')
  }
  return {
    id: stringField(raw.id, 'edge.id'),
    source: stringField(raw.source, 'edge.source'),
    target: stringField(raw.target, 'edge.target'),
    ...(sourceHandle === undefined ? {} : { sourceHandle }),
  }
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function portableWorkflow(item: AuthoringItem): WorkflowExportDocument['workflow'] {
  const nodes = (item.nodes ?? []).map(node => ({
    ...node,
    ...(node.config === undefined ? {} : { config: { ...node.config } }),
  }))
  const edges = (item.edges ?? []).map(edge => ({ ...edge }))
  return {
    title: item.title.trim(),
    description: item.description,
    body: item.body,
    steps: [...item.steps],
    nodes,
    edges,
    ...(item.viewport === undefined ? {} : { viewport: item.viewport }),
  }
}

/** Create a portable workflow document. Credential fields are references only; values are never read. */
export function createWorkflowExport(item: AuthoringItem): WorkflowExportDocument {
  return {
    kind: 'dsh-workflow',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workflow: portableWorkflow(item),
  }
}

/** Serialize a workflow for download or clipboard transfer. */
export function serializeWorkflow(item: AuthoringItem, format: WorkflowExportFormat): string {
  const document = createWorkflowExport(item)
  return format === 'yaml' ? stringifyYaml(document, { indent: 2, lineWidth: 120 }) : JSON.stringify(document, null, 2)
}

function normalizeDocument(value: unknown): WorkflowExportDocument['workflow'] {
  const envelope = record(value)
  if (envelope.kind !== undefined || envelope.schemaVersion !== undefined) {
    if (envelope.kind !== 'dsh-workflow' || envelope.schemaVersion !== 1) throw new Error('Unsupported workflow export version')
    return record(envelope.workflow) as WorkflowExportDocument['workflow']
  }
  // Accept the raw workflow object as a convenience for hand-authored files.
  return envelope as unknown as WorkflowExportDocument['workflow']
}

/**
 * Parse and normalize a downloaded workflow. Imported workflows always become drafts
 * with a fresh identity so an import cannot silently overwrite a published workflow.
 */
export function parseWorkflowExport(text: string, format?: WorkflowExportFormat): AuthoringItem {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('Workflow export is too large')
  const parsed = format === 'json' ? JSON.parse(text) : parseYaml(text)
  const raw = normalizeDocument(parsed)
  const title = stringField(raw.title, 'title').trim()
  if (title === '') throw new Error('Workflow title cannot be empty')
  const nodesRaw = raw.nodes
  const edgesRaw = raw.edges
  if (!Array.isArray(nodesRaw) || nodesRaw.length === 0 || nodesRaw.length > MAX_NODES) throw new Error('Workflow node count is invalid')
  if (!Array.isArray(edgesRaw) || edgesRaw.length > MAX_EDGES) throw new Error('Workflow edge count is invalid')
  const nodes = nodesRaw.map(parseNode)
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate workflow node id "${node.id}"`)
    nodeIds.add(node.id)
  }
  const edges = edgesRaw.map(parseEdge)
  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate workflow edge id "${edge.id}"`)
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) throw new Error('Workflow edge references an invalid node')
    edgeIds.add(edge.id)
  }
  const steps = Array.isArray(raw.steps) ? raw.steps.map((step, index) => stringField(step, `steps[${index}]`)) : []
  const body = stringField(raw.body, 'body', false)
  const description = stringField(raw.description, 'description', false)
  const viewport = raw.viewport
  if (viewport !== undefined && viewport !== null) {
    const view = record(viewport)
    if (typeof view.x !== 'number' || typeof view.y !== 'number' || typeof view.zoom !== 'number') throw new Error('Workflow viewport is invalid')
  }
  return {
    id: uniqueId('workflow-import'),
    title,
    description,
    enabled: true,
    body,
    steps,
    nodes,
    edges,
    ...(viewport === undefined ? {} : { viewport: viewport as WorkflowViewport | null }),
    workflowStatus: 'draft',
    version: 0,
    updatedAt: Date.now(),
  }
}

/** Trigger a browser download without exposing workflow contents to a remote service. */
export function downloadWorkflow(item: AuthoringItem, format: WorkflowExportFormat): void {
  const body = serializeWorkflow(item, format)
  const blob = new Blob([body], { type: format === 'yaml' ? 'text/yaml;charset=utf-8' : 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const base = item.title.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow'
  anchor.href = url
  anchor.download = `${base}.${format === 'yaml' ? 'yaml' : 'json'}`
  anchor.click()
  URL.revokeObjectURL(url)
}
