// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowPanel } from '../src/client/authoring/WorkflowPanel.tsx'
import { zh } from '../src/client/locales.ts'
import { releasedWorkflow, type AuthoringItem } from '../src/authoring-settings.ts'
import type { WorkflowCredentialControls, WorkflowDebugEvent, WorkflowRunView } from '../src/client/authoring/workflow-debug.ts'
import { workflowRuntimeName } from '../src/client/authoring/workflow-debug.ts'
import { compileWorkflow } from '../src/workflow-compile.ts'
import { serializeWorkflow } from '../src/workflow-io.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const setup = (
  items: AuthoringItem[] = [],
  save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {}),
  remove = vi.fn(async () => {}),
) => {
  const invoke = vi.fn(async () => {})
  render(<WorkflowPanel items={items} writable save={save} remove={remove} invoke={invoke} t={key => zh[key]} />)
  return { save, invoke, remove }
}

const publishedWorkflow = (overrides: Partial<AuthoringItem> = {}): AuthoringItem => {
  const nodes: NonNullable<AuthoringItem['nodes']> = [
    { id: 'start', kind: 'start', title: '开始', instructions: '', x: 0, y: 0 },
    { id: 'end', kind: 'end', title: '结束', instructions: '', x: 220, y: 0 },
  ]
  const edges: NonNullable<AuthoringItem['edges']> = [{ id: 'edge', source: 'start', target: 'end' }]
  return {
    id: 'workflow-release', title: '线上流程', description: '线上描述', enabled: true, body: '线上说明', steps: [],
    nodes, edges, workflowStatus: 'published', version: 1, updatedAt: 1,
    versions: [{ version: 1, publishedAt: 1, title: '线上流程', description: '线上描述', body: '线上说明', steps: [], nodes, edges }],
    ...overrides,
  }
}

describe('Workflow workspace', () => {
  it('shows ready-made templates and imports one into my workflows', async () => {
    const { save } = setup()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    fireEvent.click(within(screen.getAllByRole('article')[0]!).getByRole('button', { name: '一键导入' }))
    await waitFor(() => {
      const imported = save.mock.calls[0]?.[0]
      expect(imported).toEqual(expect.objectContaining({ id: 'builtin-workflow-meeting-summary', title: '会议纪要整理', nodes: expect.arrayContaining([expect.objectContaining({ kind: 'input' }), expect.objectContaining({ kind: 'output' })]), versions: [expect.objectContaining({ version: 1 })] }))
      expect(imported === undefined ? undefined : compileWorkflow(imported)).toBeDefined()
    })
  })

  it('imports a JSON or YAML workflow file as a draft', async () => {
    const item: AuthoringItem = { id: 'workflow-file', title: '文件流程', description: '导入', enabled: true, body: '执行', steps: [], nodes: [
      { id: 'start', kind: 'start', title: '开始', instructions: '', x: 0, y: 0 },
      { id: 'end', kind: 'end', title: '结束', instructions: '', x: 220, y: 0 },
    ], edges: [{ id: 'edge', source: 'start', target: 'end' }], updatedAt: 1 }
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    setup([], save)
    const input = screen.getByLabelText('导入文件')
    const file = new File([serializeWorkflow(item, 'json')], 'workflow.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '文件流程', workflowStatus: 'draft', id: expect.stringMatching(/^workflow-import-/) })) })
  })

  it('exports the edited graph without sending it to a server', async () => {
    const item: AuthoringItem = { id: 'workflow-export', title: '导出流程', description: '导出', enabled: true, body: '执行', steps: [], nodes: [
      { id: 'start', kind: 'start', title: '开始', instructions: '', x: 0, y: 0 },
      { id: 'end', kind: 'end', title: '结束', instructions: '', x: 220, y: 0 },
    ], edges: [{ id: 'edge', source: 'start', target: 'end' }], updatedAt: 1 }
    setup([item])
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }))
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('imports every built-in template as an executable graph', async () => {
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    setup([], save)
    for (const [index, card] of screen.getAllByRole('article').entries()) {
      fireEvent.click(within(card).getByRole('button', { name: '一键导入' }))
      await waitFor(() => { expect(save).toHaveBeenCalledTimes(index + 1) })
    }
    expect(save).toHaveBeenCalledTimes(3)
    for (const [item] of save.mock.calls) expect(compileWorkflow(item)).toBeDefined()
    const review = save.mock.calls.find(([item]) => item.id.endsWith('content-review'))?.[0]
    expect(review?.edges?.filter(edge => edge.sourceHandle !== undefined)).toHaveLength(2)
  })

  it('uses an imported workflow in chat and opens its editor', async () => {
    const item: AuthoringItem = { id: 'builtin-workflow-meeting-summary', title: '会议纪要整理', description: '整理会议', enabled: true, body: '整理输入', steps: ['提取事实'], updatedAt: 1 }
    const { invoke } = setup([item])
    expect(screen.getByRole('button', { name: '用于对话' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '用于对话' }))
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith(item.id, item.title) })
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    expect(screen.getByRole('heading', { name: '编辑工作流' })).toBeTruthy()
    expect(screen.getByLabelText('名称')).toHaveProperty('value', item.title)
  })

  it('keeps draft workflows out of the normal chat action', () => {
    const draft: AuthoringItem = { id: 'workflow-draft', title: '草稿流程', description: '草稿', enabled: true, body: '执行', steps: [], workflowStatus: 'draft', updatedAt: 1 }
    const published: AuthoringItem = { id: 'workflow-published', title: '已发布流程', description: '发布', enabled: true, body: '执行', steps: [], workflowStatus: 'published', updatedAt: 1 }
    const releasedDraft: AuthoringItem = { ...draft, id: 'workflow-released-draft', title: '有线上版的草稿', version: 1, versions: [{ version: 1, publishedAt: 1, title: '线上流程', description: '线上', body: '运行线上版', steps: [], nodes: [{ id: 'start', kind: 'start', title: '开始', instructions: '', x: 0, y: 0 }, { id: 'end', kind: 'end', title: '结束', instructions: '', x: 200, y: 0 }], edges: [{ id: 'edge', source: 'start', target: 'end' }] }] }
    setup([draft, published, releasedDraft])
    const cards = screen.getAllByRole('article')
    const draftCard = cards.find(card => card.textContent?.includes('草稿流程'))
    const publishedCard = cards.find(card => card.textContent?.includes('已发布流程'))
    const releasedDraftCard = cards.find(card => card.textContent?.includes('有线上版的草稿'))
    expect(draftCard).toBeDefined()
    expect(publishedCard).toBeDefined()
    expect(releasedDraftCard).toBeDefined()
    expect(within(draftCard!).getByRole('button', { name: '用于对话' })).toHaveProperty('disabled', true)
    expect(within(publishedCard!).getByRole('button', { name: '用于对话' })).toHaveProperty('disabled', false)
    expect(within(releasedDraftCard!).getByRole('button', { name: '用于对话' })).toHaveProperty('disabled', false)
    expect(within(releasedDraftCard!).getByText('草稿 · 线上 v1')).toBeTruthy()
  })

  it('creates and saves a custom workflow', async () => {
    const { save } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '发布检查' } })
    fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '检查内容后输出问题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '发布检查', body: '检查内容后输出问题' })) })
  })

  it('adds a visual node and persists graph data', async () => {
    const { save } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '画布流程' } })
    fireEvent.click(screen.getByRole('button', { name: '工具调用' }))
    expect(screen.getByRole('region', { name: '工作流画布' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '画布流程', nodes: expect.arrayContaining([expect.objectContaining({ kind: 'tool' })]), edges: expect.any(Array) })) })
  })

  it('keeps the workflow draft when saving fails', async () => {
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>().mockRejectedValue(new Error('offline'))
    setup([], save)
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '暂存工作流' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText<HTMLInputElement>('名称').value).toBe('暂存工作流')
  })

  it('filters templates by search and source', () => {
    setup()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '会议' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /我的工作流/ }))
    expect(screen.getByText('还没有工作流，先导入一个模板吧。')).toBeTruthy()
  })

  it('duplicates and deletes a saved workflow', async () => {
    const item = publishedWorkflow({ id: 'workflow-one', title: '我的流程', testInput: 'secret test', testInputMode: 'json', testTimeoutMs: 5000 })
    const { save, remove } = setup([item])
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '我的流程 副本', id: expect.stringMatching(/^workflow-/), workflowStatus: 'draft', version: 0, versions: [] })) })
    const copy = save.mock.calls[0]?.[0]
    expect(copy).not.toHaveProperty('testInput')
    expect(copy).not.toHaveProperty('testInputMode')
    expect(copy).not.toHaveProperty('testTimeoutMs')
    expect(copy === undefined ? undefined : releasedWorkflow(copy)).toBeUndefined()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith(item.id) })
  })

  it('saves and runs a valid draft from the canvas editor', async () => {
    const { save, invoke } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '可测试流程' } })
    fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '处理输入并输出结果' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '可测试流程' })) })
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith(expect.stringMatching(/^workflow-/), '可测试流程') })
  })

  it('uses the direct workflow runner when the Host Session is available', async () => {
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    const invoke = vi.fn(async () => {})
    const run = vi.fn(async () => {})
    render(<WorkflowPanel items={[]} writable save={save} invoke={invoke} run={run} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '直接运行流程' } })
    fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '直接执行画布' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))
    await waitFor(() => { expect(run).toHaveBeenCalledWith(expect.objectContaining({ title: '直接运行流程', nodes: expect.any(Array) })) })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('passes saved test input to the direct runner and exposes cancellation', async () => {
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    const run = vi.fn(async () => ({ runId: 'run-input', status: 'running' as const, startedAt: Date.now() }))
    const cancel = vi.fn(async () => {})
    const status = vi.fn(async (): Promise<WorkflowRunView> => ({ runId: 'run-input', workflowId: 'workflow-test', name: 'ui-workflow-test', status: 'running', startedAt: Date.now(), agentsStarted: 0 }))
    render(<WorkflowPanel items={[]} writable save={save} invoke={vi.fn(async () => {})} run={run} runControls={{ cancel, status }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '输入流程' } })
    fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '执行输入' } })
    fireEvent.change(screen.getByLabelText('测试输入'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))
    await waitFor(() => { expect(run).toHaveBeenCalledWith(expect.objectContaining({ testInput: 'hello' }), { mode: 'text', text: 'hello' }) })
    await waitFor(() => { expect(screen.getByRole('button', { name: '停止运行' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '停止运行' }))
    await waitFor(() => { expect(cancel).toHaveBeenCalledWith('run-input') })
  })

  it('keeps a published workflow published when only direct-test settings change', async () => {
    const item = publishedWorkflow()
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    render(<WorkflowPanel items={[item]} writable save={save} invoke={vi.fn(async () => {})} run={vi.fn(async () => undefined)} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    fireEvent.change(screen.getByLabelText('测试输入'), { target: { value: 'new test input' } })
    fireEvent.click(screen.getByRole('button', { name: '保存测试输入' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ testInput: 'new test input', workflowStatus: 'published', version: 1 })) })
  })

  it('tests changed release content as a draft while retaining the prior live snapshot', async () => {
    const item = publishedWorkflow()
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    const run = vi.fn(async () => undefined)
    render(<WorkflowPanel items={[item]} writable save={save} invoke={vi.fn(async () => {})} run={run} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '未发布的新说明' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: '未发布的新说明', workflowStatus: 'draft', version: 1 })) })
    await waitFor(() => { expect(run).toHaveBeenCalledWith(expect.objectContaining({ body: '未发布的新说明', workflowStatus: 'draft', version: 1 })) })
    const savedDraft = save.mock.calls[0]?.[0]
    expect(savedDraft === undefined ? undefined : releasedWorkflow(savedDraft)).toMatchObject({ body: '线上说明', workflowStatus: 'published', version: 1 })
  })

  it('renders a completed result, loads history, and retries the last run', async () => {
    const item: AuthoringItem = { id: 'workflow-result', title: '结果流程', description: '结果', enabled: true, body: '执行', steps: ['执行'], workflowStatus: 'published', updatedAt: 1 }
    const completed: WorkflowRunView = { runId: 'run-complete', workflowId: item.id, workflowVersion: 3, name: 'ui-workflow-result', status: 'completed', startedAt: 100, endedAt: 250, agentsStarted: 2, value: { answer: 'ok' } }
    const run = vi.fn(async () => ({ runId: 'run-new', status: 'running' as const, startedAt: 300 }))
    const status = vi.fn(async () => completed)
    const list = vi.fn(async () => [completed])
    render(<WorkflowPanel items={[item]} writable save={vi.fn(async () => {})} invoke={vi.fn(async () => {})} run={run} runControls={{ status, list }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    await waitFor(() => { expect(screen.getAllByText('已完成').length).toBeGreaterThan(0) })
    expect(screen.getByText('版本 v3')).toBeTruthy()
    expect(screen.getByText((_content, element) => element?.tagName === 'PRE' &&  element.textContent?.includes('"answer"'))).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试上次运行' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试上次运行' }))
    await waitFor(() => { expect(run).toHaveBeenCalledTimes(1) })
    expect(list).toHaveBeenCalledWith(item.id)
  })

  it('summarizes recent workflow reliability and latency metrics', async () => {
    const item = publishedWorkflow({ id: 'workflow-metrics', title: '指标流程' })
    const runs: WorkflowRunView[] = [
      { runId: 'run-error', workflowId: item.id, name: 'ui-workflow-metrics', status: 'error', startedAt: 100, endedAt: 500, agentsStarted: 1, error: 'failed' },
      { runId: 'run-ok', workflowId: item.id, name: 'ui-workflow-metrics', status: 'completed', startedAt: 100, endedAt: 200, agentsStarted: 1 },
    ]
    render(<WorkflowPanel items={[item]} writable save={vi.fn(async () => {})} invoke={vi.fn(async () => {})} runControls={{ list: vi.fn(async () => runs) }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    const metrics = await screen.findByRole('region', { name: '运行指标' })
    expect(within(metrics).getByText('最近 2 次')).toBeTruthy()
    expect(within(metrics).getByText('50%')).toBeTruthy()
    expect(within(metrics).getByText('400 ms')).toBeTruthy()
    expect(within(metrics).getByText('失败运行').nextElementSibling?.textContent).toBe('1')
  })

  it('manages referenced credentials without persisting secret values in the workflow', async () => {
    const item = publishedWorkflow({
      id: 'workflow-credential',
      title: '凭据流程',
      nodes: [
        { id: 'start', kind: 'start', title: '开始', instructions: '', x: 0, y: 0 },
        { id: 'http', kind: 'http', title: '接口请求', instructions: '调用接口', config: { url: 'https://example.com', method: 'GET', credential: 'SERVICE_KEY' }, x: 220, y: 0 },
        { id: 'end', kind: 'end', title: '结束', instructions: '', x: 440, y: 0 },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'http' }, { id: 'e2', source: 'http', target: 'end' }],
    })
    const describe = vi.fn<WorkflowCredentialControls['describe']>()
      .mockResolvedValueOnce({ configured: false, writable: true })
      .mockResolvedValueOnce({ configured: true, writable: true, source: 'local' })
      .mockResolvedValue({ configured: false, writable: true })
    const set = vi.fn<WorkflowCredentialControls['set']>(async () => {})
    const unset = vi.fn<WorkflowCredentialControls['unset']>(async () => {})
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})
    render(<WorkflowPanel items={[item]} writable save={save} invoke={vi.fn(async () => {})} credentials={{ describe, set, unset }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    const httpNode = screen.getByRole('region', { name: '工作流画布' }).querySelector('[data-node-id="http"]')
    const nodeButtons = httpNode?.querySelectorAll('button')
    if (nodeButtons === undefined || nodeButtons.length < 2) throw new Error('HTTP node body was not rendered')
    fireEvent.click(nodeButtons[1]!)
    await waitFor(() => { expect(describe).toHaveBeenCalledWith('SERVICE_KEY') })
    expect(await screen.findByText('凭据未配置')).toBeTruthy()
    const secret = screen.getByLabelText<HTMLInputElement>('凭据值')
    expect(secret.type).toBe('password')
    fireEvent.change(secret, { target: { value: 'workflow-secret' } })
    fireEvent.click(screen.getByRole('button', { name: '保存凭据' }))
    await waitFor(() => { expect(set).toHaveBeenCalledWith('SERVICE_KEY', 'workflow-secret') })
    await waitFor(() => { expect(screen.getByText('凭据已配置')).toBeTruthy() })
    expect(screen.queryByDisplayValue('workflow-secret')).toBeNull()
    expect(save).not.toHaveBeenCalled()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除凭据' }))
    await waitFor(() => { expect(unset).toHaveBeenCalledWith('SERVICE_KEY') })
    await waitFor(() => { expect(screen.getByText('凭据未配置')).toBeTruthy() })
  })

  it('renders persisted node statuses and audit details for a historical run', async () => {
    const item: AuthoringItem = { id: 'workflow-audit-ui', title: '审计流程', description: '审计', enabled: true, body: '执行', steps: [], workflowStatus: 'published', updatedAt: 1, nodes: [
      { id: 'start', kind: 'start', title: '开始', instructions: '', x: 0, y: 0 },
      { id: 'model', kind: 'llm', title: '模型节点', instructions: '处理输入', x: 240, y: 0 },
      { id: 'end', kind: 'end', title: '结束', instructions: '', x: 480, y: 0 },
    ], edges: [{ id: 'e1', source: 'start', target: 'model' }, { id: 'e2', source: 'model', target: 'end' }] }
    const completed: WorkflowRunView = {
      runId: 'run-audit', workflowId: item.id, name: 'ui-workflow-audit-ui', status: 'completed', startedAt: 100, endedAt: 260, agentsStarted: 1,
      audit: [
        { correlationId: 'run-audit', nodeId: 'start', label: '开始', status: 'completed', startedAt: 101, endedAt: 102, durationMs: 1, retryCount: 0 },
        { correlationId: 'run-audit', nodeId: 'model', label: '模型节点', status: 'completed', startedAt: 110, endedAt: 250, durationMs: 140, retryCount: 1, inputSummary: '输入摘要', outputSummary: '输出摘要' },
        { correlationId: 'run-audit', nodeId: 'end', label: '结束', status: 'skipped', startedAt: 251, retryCount: 0 },
      ],
    }
    const list = vi.fn(async () => [completed])
    render(<WorkflowPanel items={[item]} writable save={vi.fn(async () => {})} invoke={vi.fn(async () => {})} run={vi.fn(async () => undefined)} runControls={{ list }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    await waitFor(() => { expect(screen.getByText('节点时间线')).toBeTruthy() })
    const canvas = screen.getByRole('region', { name: '工作流画布' })
    const completedNode = canvas.querySelector('[data-node-id="model"]')
    expect(completedNode).toBeTruthy()
    expect(completedNode?.getAttribute('data-run-status')).toBe('completed')
    const nodeButtons = completedNode?.querySelectorAll('button')
    if (nodeButtons === undefined || nodeButtons.length < 2) throw new Error('model node body was not rendered')
    fireEvent.click(nodeButtons[1]!)
    expect(screen.getAllByText('输入摘要').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('输出摘要').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('耗时 140 ms')).toBeTruthy()
    expect(screen.getByText('重试 1 次')).toBeTruthy()
    expect(screen.getAllByText('已跳过').length).toBeGreaterThanOrEqual(2)
    expect(list).toHaveBeenCalledWith(item.id)
  })

  it('renders a failed run error and a timeout as a distinct status', async () => {
    const item: AuthoringItem = { id: 'workflow-failure', title: '失败流程', description: '失败', enabled: true, body: '执行', steps: ['执行'], workflowStatus: 'published', updatedAt: 1 }
    const failed: WorkflowRunView = { runId: 'run-failed', workflowId: item.id, name: 'ui-workflow-failure', status: 'error', startedAt: 100, endedAt: 200, agentsStarted: 1, error: '模型不可用', timedOut: true }
    const run = vi.fn(async () => ({ runId: 'run-failed', status: 'running' as const, startedAt: 100 }))
    const status = vi.fn(async () => failed)
    render(<WorkflowPanel items={[item]} writable save={vi.fn(async () => {})} invoke={vi.fn(async () => {})} run={run} runControls={{ status }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }))
    await waitFor(() => { expect(screen.getAllByText('已超时').length).toBeGreaterThan(0) })
    expect(screen.getByText('模型不可用')).toBeTruthy()
  })

  it('publishes a snapshot and can restore it as a new draft', async () => {
    const { save } = setup()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '版本流程' } })
    fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '第一版说明' } })
    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ workflowStatus: 'published', version: 1, versions: [expect.objectContaining({ version: 1, body: '第一版说明' })] })) })

    const published = save.mock.calls.at(-1)?.[0]
    expect(published).toBeDefined()
    cleanup()
    render(<WorkflowPanel items={[published!]} writable save={save} invoke={vi.fn(async () => {})} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '查看版本历史' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复为草稿' }))
    expect(screen.getByLabelText('名称')).toHaveProperty('value', '版本流程')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ workflowStatus: 'draft', version: 1 })) })
  })

  it('renders live workflow lifecycle events for the edited workflow only', async () => {
    let listener: ((event: WorkflowDebugEvent) => void) | undefined
    const item: AuthoringItem = { id: 'workflow-debug', title: '调试流程', description: '调试', enabled: true, body: '运行', steps: ['运行'], workflowStatus: 'published', version: 1, updatedAt: 1 }
    render(<WorkflowPanel items={[item]} writable save={vi.fn(async () => {})} invoke={vi.fn(async () => {})} subscribeDebug={(next) => { listener = next; return () => {} }} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑工作流' }))
    listener?.({ kind: 'start', runId: 'run-1', workflowName: workflowRuntimeName(item.id), at: 1 })
    listener?.({ kind: 'phase', runId: 'run-1', workflowName: workflowRuntimeName(item.id), title: '处理节点', at: 2 })
    listener?.({ kind: 'log', runId: 'run-1', workflowName: workflowRuntimeName(item.id), message: '请求已发送', at: 3 })
    listener?.({ kind: 'phase', runId: 'other', workflowName: workflowRuntimeName(item.id), title: '不应显示', at: 4 })
    await waitFor(() => {
      expect(screen.getByText('处理节点')).toBeTruthy()
      expect(screen.getByText('请求已发送')).toBeTruthy()
      expect(screen.queryByText('不应显示')).toBeNull()
    })
  })
})
