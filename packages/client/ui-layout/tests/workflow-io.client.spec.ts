import { describe, expect, it } from 'vitest'
import type { AuthoringItem } from '../src/authoring-settings.ts'
import { parseWorkflowExport, serializeWorkflow } from '../src/workflow-io.ts'

const item: AuthoringItem = {
  id: 'workflow-io',
  title: '资料处理',
  description: '测试导入导出',
  enabled: true,
  body: '处理输入',
  steps: ['读取资料', '输出结果'],
  nodes: [
    { id: 'start', kind: 'start', title: '开始', instructions: '', x: 20, y: 30 },
    { id: 'model', kind: 'llm', title: '处理', instructions: '提炼重点', config: { model: 'deepseek-chat', credential: 'MODEL_KEY' }, x: 240, y: 30 },
    { id: 'end', kind: 'end', title: '结束', instructions: '', x: 460, y: 30 },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'model' },
    { id: 'e2', source: 'model', target: 'end' },
  ],
  workflowStatus: 'published',
  version: 2,
  updatedAt: 123,
}

describe('workflow interchange', () => {
  it.each(['json', 'yaml'] as const)('round-trips a %s workflow as a fresh draft', (format) => {
    const imported = parseWorkflowExport(serializeWorkflow(item, format), format)
    expect(imported.id).toMatch(/^workflow-import-/)
    expect(imported.id).not.toBe(item.id)
    expect(imported.title).toBe(item.title)
    expect(imported.nodes).toEqual(item.nodes)
    expect(imported.edges).toEqual(item.edges)
    expect(imported.workflowStatus).toBe('draft')
    expect(imported.version).toBe(0)
  })

  it('rejects invalid graphs and oversized files before saving', () => {
    expect(() => parseWorkflowExport(JSON.stringify({ kind: 'dsh-workflow', schemaVersion: 2, workflow: {} }), 'json')).toThrow(/version/i)
    expect(() => parseWorkflowExport(JSON.stringify({ title: 'bad', nodes: [{ id: 'x', kind: 'llm', title: 'x', x: 0, y: 0 }], edges: [{ id: 'e', source: 'x', target: 'missing' }] }), 'json')).toThrow(/invalid node/i)
    expect(() => parseWorkflowExport('x'.repeat(1024 * 1024 + 1), 'json')).toThrow(/large/i)
  })
})

