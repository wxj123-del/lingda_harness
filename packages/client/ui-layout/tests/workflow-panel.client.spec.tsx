// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowPanel } from '../src/client/authoring/WorkflowPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { AuthoringItem } from '../src/authoring-settings.ts'

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

describe('Workflow workspace', () => {
  it('shows ready-made templates and imports one into my workflows', async () => {
    const { save } = setup()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    fireEvent.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: '一键导入' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'builtin-workflow-meeting-summary', title: '会议纪要整理', nodes: expect.arrayContaining([expect.objectContaining({ kind: 'input' }), expect.objectContaining({ kind: 'output' })]) })) })
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
    const item: AuthoringItem = { id: 'workflow-one', title: '我的流程', description: '描述', enabled: true, body: '执行', steps: ['一步'], updatedAt: 1 }
    const { save, remove } = setup([item])
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '我的流程 副本', id: expect.stringMatching(/^workflow-/) })) })
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
})
