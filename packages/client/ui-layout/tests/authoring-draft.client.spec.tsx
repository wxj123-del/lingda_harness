// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { layoutDraftEdges, layoutDraftNodes, knowledgeDocumentsFromDraft, workflowItemFromDraft } from '../src/authoring-draft.ts'
import { AuthoringChat } from '../src/client/authoring/AuthoringChat.tsx'

afterEach(() => { cleanup() })

const DRAFT = {
  title: '前端页面工作流',
  description: '从需求到页面',
  steps: ['拆需求', '写页面'],
  nodes: [
    { kind: 'start' as const, title: '开始', instructions: '' },
    { kind: 'llm' as const, title: '拆需求', instructions: '拆解需求' },
    { kind: 'condition' as const, title: '是否通过', instructions: '', config: { condition: '通过吗' } },
    { kind: 'output' as const, title: '交付', instructions: '' },
    { kind: 'end' as const, title: '结束', instructions: '' },
  ],
  edges: [
    { source: 0, target: 1 },
    { source: 1, target: 2 },
    { source: 2, target: 3, sourceHandle: 'true' as const },
    { source: 2, target: 4, sourceHandle: 'false' as const },
  ],
}

describe('authoring draft conversion', () => {
  it('lays generated nodes out in columns with unique ids', () => {
    const laidOut = layoutDraftNodes(DRAFT.nodes, DRAFT.edges)
    expect(laidOut.nodes).toHaveLength(5)
    expect(new Set(laidOut.ids).size).toBe(5)
    const start = laidOut.nodes[0]
    const second = laidOut.nodes[1]
    expect(start?.x).toBeLessThan(second?.x ?? 0)
    expect(start?.kind).toBe('start')
  })

  it('maps draft edge indices onto generated node ids and keeps branch handles', () => {
    const laidOut = layoutDraftNodes(DRAFT.nodes, DRAFT.edges)
    const edges = layoutDraftEdges(DRAFT.edges, laidOut.ids)
    expect(edges).toHaveLength(4)
    expect(edges[0]?.source).toBe(laidOut.ids[0])
    expect(edges[0]?.target).toBe(laidOut.ids[1])
    expect(edges[2]?.sourceHandle).toBe('true')
    expect(edges[3]?.sourceHandle).toBe('false')
  })

  it('builds an unpublished workflow item the editor can open', () => {
    const item = workflowItemFromDraft(DRAFT)
    expect(item.title).toBe('前端页面工作流')
    expect(item.workflowStatus).toBe('draft')
    expect(item.version).toBe(0)
    expect(item.nodes).toHaveLength(5)
    expect(item.edges).toHaveLength(4)
    expect(item.updatedAt).toBeGreaterThan(0)
  })

  it('carries the source URL into the generated document body', () => {
    const documents = knowledgeDocumentsFromDraft({
      title: '规范',
      description: '',
      documents: [{ title: '命名', content: '组件用 PascalCase。', source: 'https://example.com/a' }],
    })
    expect(documents[0]?.title).toBe('命名')
    expect(documents[0]?.content).toContain('https://example.com/a')
  })

  it('sends the typed message from the chat composer', () => {
    const onSend = vi.fn()
    render(<AuthoringChat
      title="Design"
      intro="Describe it"
      placeholder="Describe the process"
      messages={[]}
      busy={false}
      error={null}
      onSend={onSend}
      onApply={vi.fn()}
      onClose={vi.fn()}
      t={key => key}
    />)
    fireEvent.change(screen.getByPlaceholderText('Describe the process'), { target: { value: '  build a page  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.send' }))
    expect(onSend).toHaveBeenCalledWith('build a page')
  })

  it('offers an apply action only on assistant turns that produced a draft', () => {
    const onApply = vi.fn()
    render(<AuthoringChat
      title="Design"
      intro="Describe it"
      placeholder="Describe the process"
      messages={[
        { id: 'u1', role: 'user', text: 'build it' },
        { id: 'a1', role: 'assistant', text: 'Draft ready', draftReady: true },
        { id: 'a2', role: 'assistant', text: 'Which module first?' },
      ]}
      busy={false}
      error={null}
      onSend={vi.fn()}
      onApply={onApply}
      onClose={vi.fn()}
      t={key => key}
    />)
    const apply = screen.getAllByRole('button', { name: 'chat.apply' })
    expect(apply).toHaveLength(1)
    fireEvent.click(apply[0] as HTMLElement)
    expect(onApply).toHaveBeenCalledWith('a1')
  })

  it('shows per-source fetch outcomes on a knowledge reply', () => {
    render(<AuthoringChat
      title="Design"
      intro="Describe it"
      placeholder="Describe the process"
      messages={[{
        id: 'a1',
        role: 'assistant',
        text: 'Draft ready',
        draftReady: true,
        sources: [{ url: 'https://example.com/a', status: 'ok' }, { url: 'https://bad.test', status: 'failed', detail: 'HTTP 404' }],
      }]}
      busy={false}
      error={null}
      onSend={vi.fn()}
      onApply={vi.fn()}
      onClose={vi.fn()}
      t={key => key}
    />)
    expect(screen.getByText('https://example.com/a')).toBeTruthy()
    expect(screen.getByText(/HTTP 404/)).toBeTruthy()
  })
})
