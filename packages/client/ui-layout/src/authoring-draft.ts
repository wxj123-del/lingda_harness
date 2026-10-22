/** Convert an assistant draft into the persisted authoring shapes. */

import type {
  DraftWorkflowEdge,
  DraftWorkflowNode,
  WorkflowDraft,
  KnowledgeDraft,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { AuthoringItem, WorkflowEdge, WorkflowNode } from './authoring-settings.ts'

/** Horizontal and vertical spacing used to lay a generated graph out on the canvas. */
const COLUMN_WIDTH = 220
const ROW_HEIGHT = 150
const ORIGIN_X = 70
const ORIGIN_Y = 220

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** One laid-out graph: nodes in model order plus the index-to-id mapping edges use. */
export interface LaidOutDraft {
  nodes: WorkflowNode[]
  /** Generated node id per draft node index. */
  ids: string[]
}

/**
 * Place generated nodes on the canvas in execution order.
 *
 * The model returns nodes and edges by index; the editor needs stable ids and
 * coordinates. A breadth-first walk from start gives each node a column, and
 * siblings in one column stack vertically, so the graph reads left to right.
 * @param draftNodes - draft nodes in model order.
 * @param edges - draft edges by node index.
 * @returns canvas nodes in model order and the id for each draft index.
 */
export function layoutDraftNodes(
  draftNodes: readonly DraftWorkflowNode[],
  edges: readonly DraftWorkflowEdge[],
): LaidOutDraft {
  const adjacency = new Map<number, number[]>()
  for (const edge of edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target])
  }
  const start = draftNodes.findIndex(node => node.kind === 'start')
  const order: number[] = []
  const seen = new Set<number>()
  const queue = start === -1 ? draftNodes.map((_, index) => index) : [start]
  while (queue.length > 0) {
    const index = queue.shift() as number
    if (seen.has(index)) continue
    seen.add(index)
    order.push(index)
    for (const next of adjacency.get(index) ?? []) queue.push(next)
  }
  for (let index = 0; index < draftNodes.length; index += 1) {
    if (!seen.has(index)) order.push(index)
  }
  const depth = new Map<number, number>()
  const stack = new Map<number, number>()
  for (const index of order) {
    const parents = edges.filter(edge => edge.target === index).map(edge => edge.source)
    const column = parents.length === 0
      ? 0
      : Math.max(...parents.map(parent => (depth.get(parent) ?? 0) + 1))
    depth.set(index, column)
    stack.set(index, stack.get(column) ?? 0)
    stack.set(column, (stack.get(column) ?? 0) + 1)
  }
  const ids = draftNodes.map(() => newId('node'))
  return {
    ids,
    nodes: draftNodes.map((node, index) => ({
      id: ids[index] as string,
      kind: node.kind,
      title: node.title,
      instructions: node.instructions,
      ...(node.config === undefined ? {} : { config: { ...node.config } }),
      x: ORIGIN_X + (depth.get(index) ?? 0) * COLUMN_WIDTH,
      y: ORIGIN_Y + (stack.get(index) ?? 0) * ROW_HEIGHT,
    })),
  }
}

/**
 * Convert draft edges into canvas edges keyed by the generated node ids.
 * @param edges - draft edges by node index.
 * @param ids - generated node id per draft index.
 * @returns canvas edges.
 */
export function layoutDraftEdges(
  edges: readonly DraftWorkflowEdge[],
  ids: readonly string[],
): WorkflowEdge[] {
  return edges.flatMap((edge) => {
    const source = ids[edge.source]
    const target = ids[edge.target]
    if (source === undefined || target === undefined) return []
    return [{
      id: `edge-${source}-${target}${edge.sourceHandle === undefined ? '' : `-${edge.sourceHandle}`}`,
      source,
      target,
      ...(edge.sourceHandle === undefined ? {} : { sourceHandle: edge.sourceHandle }),
    }]
  })
}

/**
 * Build a new workflow item from an assistant draft.
 * @param draft - accepted workflow draft.
 * @returns an unpublished workflow item ready for the editor.
 */
export function workflowItemFromDraft(draft: WorkflowDraft): AuthoringItem {
  const laidOut = layoutDraftNodes(draft.nodes, draft.edges)
  return {
    id: newId('workflow'),
    title: draft.title,
    description: draft.description,
    enabled: true,
    body: draft.description,
    steps: [...draft.steps],
    nodes: laidOut.nodes,
    edges: layoutDraftEdges(draft.edges, laidOut.ids),
    workflowStatus: 'draft',
    version: 0,
    updatedAt: Date.now(),
  }
}

/** One knowledge document produced from a draft. */
export interface DraftDocument {
  id: string
  title: string
  content: string
  updatedAt: number
}

/**
 * Build knowledge documents from an assistant draft.
 * @param draft - accepted knowledge draft.
 * @returns documents ready for the knowledge editor.
 */
export function knowledgeDocumentsFromDraft(draft: KnowledgeDraft): DraftDocument[] {
  return draft.documents.map(document => ({
    id: newId('doc'),
    title: document.title,
    content: document.source === undefined ? document.content : `${document.content}\n\nSource: ${document.source}`,
    updatedAt: Date.now(),
  }))
}
