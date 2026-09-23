import { describe, expect, it } from 'vitest'
import type { WorkflowEdge, WorkflowNode } from '../src/authoring-settings.ts'
import { analyzeWorkflowGraph } from '../src/workflow-graph.ts'

const node = (id: string, kind: WorkflowNode['kind'], config: WorkflowNode['config'] = {}): WorkflowNode => ({
  id, kind, title: id, instructions: kind === 'llm' ? 'Process input' : '', config, x: 0, y: 0,
})

const linear = (middle: WorkflowNode[] = [], edges: WorkflowEdge[] = []): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => ({
  nodes: [node('start', 'start'), ...middle, node('end', 'end')],
  edges: edges.length > 0 ? edges : [
    { id: 'start-middle', source: 'start', target: middle[0]?.id ?? 'end' },
    ...(middle.length === 0 ? [] : [{ id: 'middle-end', source: middle.at(-1)!.id, target: 'end' }]),
  ],
})

describe('workflow graph validation', () => {
  it('accepts a valid linear graph and exposes stable compiler indexes', () => {
    const { nodes, edges } = linear([node('model', 'llm')])
    const graph = analyzeWorkflowGraph(nodes, edges)
    expect(graph.issues).toEqual([])
    expect(graph.startId).toBe('start')
    expect(graph.endId).toBe('end')
    expect(graph.order).toEqual(['start', 'model', 'end'])
  })

  it('shares strict HTTP, credential, retry and identifier validation', () => {
    const graph = analyzeWorkflowGraph([
      node('start', 'start'),
      node('http', 'http', { url: '', method: 'OPTIONS', credential: 'not-a-variable', retries: 6 }),
      node('end', 'end'),
    ], [
      { id: '', source: 'start', target: 'http' },
      { id: 'http-end', source: 'http', target: 'end' },
    ])
    expect(graph.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['http-config', 'credential', 'retries', 'edge-id']))
  })

  it('rejects duplicate edges, cycles, or disconnected nodes before compilation', () => {
    const graph = analyzeWorkflowGraph([
      node('start', 'start'), node('left', 'template'), node('orphan', 'template'), node('end', 'end'),
    ], [
      { id: 'start-left', source: 'start', target: 'left' },
      { id: 'duplicate', source: 'start', target: 'left' },
      { id: 'left-start', source: 'left', target: 'start' },
      { id: 'left-end', source: 'left', target: 'end' },
    ])
    expect(graph.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['duplicate-edge', 'unreachable', 'cycle']))
  })
})
