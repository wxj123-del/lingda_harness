// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ToolsPanel, type ToolsPanelProps } from '../src/client/authoring/ToolsPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { AuthoringItem } from '../src/authoring-settings.ts'

afterEach(cleanup)
const snapshot: Awaited<ReturnType<ToolsPanelProps['loadUsage']>> = {
  sessionCount: 2, failedSessionCount: 0, requestCount: 20, unknownCatalogRequests: 0, scannedAt: 1,
  tools: [
    { name: 'read', description: 'Read local text files', parameters: { type: 'object', properties: { path: { type: 'string' } } }, calls: 3, directCalls: 2, internalCalls: 1, exposedRequests: 10, usedRequests: 1, sessions: 2, lastUsedAt: 1000 },
    { name: 'unused', calls: 0, directCalls: 0, internalCalls: 0, exposedRequests: 20, usedRequests: 0, sessions: 0, lastUsedAt: null },
  ],
}
const custom: AuthoringItem = { id: 'custom', title: '文案整理', description: '整理文章结构', enabled: false, body: '输出整理后的文章', steps: ['读取原文'], updatedAt: 1 }
const base: ToolsPanelProps = { items: [], writable: true, loadUsage: async () => snapshot, save: async () => {}, t: key => zh[key] }

it('shows usage on cards, opens complete details and searches descriptions', async () => {
  const loadUsage = vi.fn(base.loadUsage)
  render(<ToolsPanel {...base} loadUsage={loadUsage} />)
  const read = await screen.findByRole('article', { name: 'read' })
  expect(read.textContent).toContain('已调用 3 次')
  expect(within(read).getByText(zh['tool.description.read'])).toBeTruthy()
  expect(within(read).getByText('调用命中率').nextElementSibling?.textContent).toBe('10%')
  const overview = screen.getByLabelText('工具调用指标')
  expect(within(overview).getByText('20')).toBeTruthy()
  expect(within(overview).getByText('30')).toBeTruthy()
  expect(within(overview).getByText('3.3%')).toBeTruthy()
  fireEvent.click(within(read).getByRole('button', { name: '查看详情' }))
  const dialog = screen.getByRole('dialog', { name: 'read' })
  expect(within(dialog).getByText(zh['tool.description.read'])).toBeTruthy()
  fireEvent.click(within(dialog).getByText('原始说明'))
  expect(within(dialog).getByText('Read local text files')).toBeTruthy()
  expect(within(dialog).getByText('模型调用').nextElementSibling?.textContent).toBe('2')
  expect(within(dialog).getByText('内部调用').nextElementSibling?.textContent).toBe('1')
  expect(within(dialog).getByText('携带次数').nextElementSibling?.textContent).toBe('10')
  expect(within(dialog).getByText('命中次数').nextElementSibling?.textContent).toBe('1')
  fireEvent.click(within(dialog).getByText('参数定义'))
  expect(dialog.textContent).toContain('"path"')
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭详情' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '读取文本' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'text files' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '未调用' }))
  expect(screen.getByRole('article', { name: 'unused' }).textContent).toContain('已调用 0 次')
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }))
  await screen.findByRole('article', { name: 'unused' })
  expect(loadUsage).toHaveBeenCalledTimes(2)
})

it('ranks frequent exposures and low hit rates while showing unmeasured tools separately', async () => {
  render(<ToolsPanel {...base} items={[custom]} />)
  await screen.findByRole('article', { name: 'read' })
  const sort = screen.getByRole('combobox', { name: '工具排序' })
  fireEvent.change(sort, { target: { value: 'exposure' } })
  expect(screen.getAllByRole('article')[0]?.getAttribute('data-tool-name')).toBe('unused')
  fireEvent.change(sort, { target: { value: 'rate' } })
  expect(screen.getAllByRole('article').map(card => card.getAttribute('data-tool-name')))
    .toEqual(['unused', 'read', 'user_tool_custom'])
  expect(within(screen.getByRole('article', { name: '文案整理' })).getByText('调用命中率').nextElementSibling?.textContent).toBe('—')
  fireEvent.click(screen.getByRole('button', { name: '自建工具' }))
  expect(within(screen.getByLabelText('工具调用指标')).getByText('30')).toBeTruthy()
})

it('shows missing catalog coverage and no percentage before any measured exposure', async () => {
  render(<ToolsPanel {...base} loadUsage={async () => ({ ...snapshot, tools: [], requestCount: 2, unknownCatalogRequests: 2 })} />)
  expect(await screen.findByText(/2 个请求缺少工具目录记录/)).toBeTruthy()
  expect(within(screen.getByLabelText('工具调用指标')).getByText('—')).toBeTruthy()
})

it('keeps custom tools in the catalog and merges usage by the registered name', async () => {
  render(<ToolsPanel {...base} items={[custom]} loadUsage={async () => ({ ...snapshot, tools: [...snapshot.tools, { ...snapshot.tools[0]!, name: 'user_tool_custom', calls: 7 }] })} />)
  await screen.findByRole('article', { name: '文案整理' })
  expect(screen.getAllByRole('article')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '自建工具' }))
  const card = screen.getByRole('article', { name: '文案整理' })
  expect(card.textContent).toContain('已调用 7 次')
  expect(card.textContent).toContain('未启用')
  fireEvent.click(within(card).getByRole('button', { name: '查看详情' }))
  expect(screen.getByRole('dialog').textContent).toContain(custom.body)
  fireEvent.click(screen.getByRole('button', { name: '编辑工具' }))
  expect(screen.getByLabelText<HTMLInputElement>('名称').value).toBe(custom.title)
})

it('retains an edited draft after a failed save and returns only after successful persistence', async () => {
  const save = vi.fn<ToolsPanelProps['save']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<ToolsPanel {...base} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: '新建工具' }))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  写标题  ' } })
  fireEvent.change(screen.getByLabelText('说明'), { target: { value: '输出五个标题' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect((await screen.findByRole('alert')).textContent).toBe('保存失败，请重试')
  expect(screen.getByLabelText<HTMLInputElement>('名称').value).toBe('  写标题  ')
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByRole('heading', { name: '工具' })
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ title: '写标题', body: '输出五个标题', enabled: true }))
})

it('reports failed reads and incomplete counts explicitly', async () => {
  const loadUsage = vi.fn<ToolsPanelProps['loadUsage']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...snapshot, failedSessionCount: 1 })
  render(<ToolsPanel {...base} writable={false} loadUsage={loadUsage} />)
  expect((await screen.findByRole('alert')).textContent).toBe(zh['tool.error'])
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '新建工具' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }))
  await screen.findByRole('article', { name: 'read' })
  expect(screen.getByRole('alert').textContent).toContain('1 个会话无法读取')
})

it('cancels stale reads and prevents late results from replacing current cards', async () => {
  const pending = Promise.withResolvers<typeof snapshot>()
  const original = vi.fn<ToolsPanelProps['loadUsage']>(async () => pending.promise)
  const current = vi.fn<ToolsPanelProps['loadUsage']>(async () => ({ ...snapshot, tools: [] }))
  const view = render(<ToolsPanel {...base} loadUsage={original} />)
  view.rerender(<ToolsPanel {...base} loadUsage={current} />)
  expect(original.mock.calls[0]![0].aborted).toBe(true)
  await screen.findByText(zh['tool.empty'])
  await act(async () => { pending.resolve(snapshot) })
  expect(screen.queryByRole('article')).toBeNull()
  view.unmount()
  expect(current.mock.calls[0]![0].aborted).toBe(true)
})
