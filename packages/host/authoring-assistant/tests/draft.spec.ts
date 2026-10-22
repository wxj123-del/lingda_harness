
import { describe, expect, it } from 'vitest'
import { acceptKnowledgeDraft, acceptWorkflowDraft, DraftRejected, parseDraftJson, replyText } from '../src/draft.ts'
import { htmlToText } from '../src/text.ts'
import { composeTurn, renderHistory } from '../src/prompts.ts'

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    title: '前端页面开发',
    description: '从需求到可运行页面',
    steps: ['理解需求', '生成页面'],
    nodes: [
      { kind: 'start', title: '开始' },
      { kind: 'llm', title: '规划', instructions: '规划页面结构' },
      { kind: 'end', title: '结束' },
    ],
    edges: [{ source: 0, target: 1 }, { source: 1, target: 2 }],
    ...overrides,
  }
}

describe('workflow draft validation', () => {
  it('accepts a minimal start/llm/end graph', () => {
    const draft = acceptWorkflowDraft(workflow())
    expect(draft.title).toBe('前端页面开发')
    expect(draft.nodes.map(node => node.kind)).toEqual(['start', 'llm', 'end'])
    expect(draft.edges).toHaveLength(2)
  })

  it('requires exactly one start and one end node', () => {
    expect(() => acceptWorkflowDraft(workflow({
      nodes: [{ kind: 'start', title: 'a' }, { kind: 'start', title: 'b' }, { kind: 'end', title: 'c' }],
    }))).toThrow(DraftRejected)
    expect(() => acceptWorkflowDraft(workflow({ nodes: [{ kind: 'start', title: 'a' }, { kind: 'llm', title: 'b' }] }))).toThrow(/end node/)
  })

  it('rejects a tool node without a configured tool', () => {
    expect(() => acceptWorkflowDraft(workflow({
      nodes: [{ kind: 'start', title: 'a' }, { kind: 'tool', title: 'b' }, { kind: 'end', title: 'c' }],
    }))).toThrow(/config.tool/)
  })

  it('rejects an http node without a url and method', () => {
    expect(() => acceptWorkflowDraft(workflow({
      nodes: [{ kind: 'start', title: 'a' }, { kind: 'http', title: 'b', config: { url: 'https://x.test' } }, { kind: 'end', title: 'c' }],
    }))).toThrow(/config.url and config.method/)
  })

  it('drops out-of-range, self, and duplicate edges instead of failing the draft', () => {
    const draft = acceptWorkflowDraft(workflow({
      edges: [
        { source: 0, target: 1 },
        { source: 0, target: 1 },
        { source: 1, target: 1 },
        { source: 0, target: 99 },
        { source: 1, target: 2 },
      ],
    }))
    expect(draft.edges).toEqual([{ source: 0, target: 1 }, { source: 1, target: 2 }])
  })

  it('keeps branch handles when the model supplies them', () => {
    const draft = acceptWorkflowDraft(workflow({
      nodes: [
        { kind: 'start', title: 'a' },
        { kind: 'condition', title: 'b', config: { condition: '通过吗' } },
        { kind: 'llm', title: 'c' },
        { kind: 'end', title: 'd' },
      ],
      edges: [
        { source: 0, target: 1 },
        { source: 1, target: 2, sourceHandle: 'true' },
        { source: 1, target: 3, sourceHandle: 'false' },
      ],
    }))
    expect(draft.edges[1]?.sourceHandle).toBe('true')
    expect(draft.edges[2]?.sourceHandle).toBe('false')
  })

  it('rejects unknown node kinds', () => {
    expect(() => acceptWorkflowDraft(workflow({
      nodes: [{ kind: 'start', title: 'a' }, { kind: 'teleport', title: 'b' }, { kind: 'end', title: 'c' }],
    }))).toThrow(/node kind/)
  })
})

describe('knowledge draft validation', () => {
  it('accepts a titled draft with documents', () => {
    const draft = acceptKnowledgeDraft({
      title: '前端规范',
      description: '团队前端约定',
      documents: [{ title: '命名', content: '组件使用 PascalCase。', source: 'https://example.com/style' }],
    })
    expect(draft.documents[0]?.source).toBe('https://example.com/style')
  })

  it('rejects an empty document list and an empty document body', () => {
    expect(() => acceptKnowledgeDraft({ title: 'x', documents: [] })).toThrow(/at least one document/)
    expect(() => acceptKnowledgeDraft({ title: 'x', documents: [{ title: 'a', content: '  ' }] })).toThrow(DraftRejected)
  })
})

describe('model output parsing', () => {
  it('extracts a fenced JSON object surrounded by prose', () => {
    const text = 'Here you go:\n```json\n{"title":"x"}\n```\nThanks.'
    expect(parseDraftJson(text)).toEqual({ title: 'x' })
  })

  it('handles braces inside JSON strings', () => {
    expect(parseDraftJson('{"title":"a{b}c"}')).toEqual({ title: 'a{b}c' })
  })

  it('reports unterminated JSON', () => {
    expect(() => parseDraftJson('{"title":"x"')).toThrow(/unterminated/)
  })

  it('keeps the prose part of a reply', () => {
    expect(replyText('Draft ready {"title":"x"}')).toBe('Draft ready')
    expect(replyText('Only prose')).toBe('Only prose')
  })
})

describe('prompt assembly', () => {
  it('renders bounded history and skips empty sections', () => {
    expect(renderHistory(undefined)).toBe('')
    const history = Array.from({ length: 20 }, (_, index) => ({ role: 'user' as const, text: `t${String(index)}` }))
    const rendered = renderHistory(history)
    expect(rendered).not.toContain('t7')
    expect(rendered).toContain('t19')
    expect(composeTurn(['', 'a', '  ', 'b'])).toBe('a\n\nb')
  })
})

describe('htmlToText', () => {
  it('drops scripting and styling, keeps readable text', () => {
    const html = '<html><head><title>T</title><style>.a{color:red}</style></head>'
      + '<body><script>alert(1)</script><h1>标题</h1><p>正文 &amp; 说明</p></body></html>'
    const text = htmlToText(html)
    expect(text).toContain('标题')
    expect(text).toContain('正文 & 说明')
    expect(text).not.toContain('alert(1)')
    expect(text).not.toContain('color:red')
  })
})
