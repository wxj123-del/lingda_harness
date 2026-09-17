// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  KnowledgePanel,
  type KnowledgePanelProps,
} from '../src/client/authoring/KnowledgePanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const library = {
  id: 'test-library' as never,
  title: '测试资料',
  description: '',
  enabled: true,
  split: { mode: 'recursive' as const, size: 400, overlap: 60 },
  documents: [{ id: 'doc' as never, title: '说明', content: '测试正文', updatedAt: 1 }],
  revision: 1,
  updatedAt: 1,
}

function fixture(): KnowledgePanelProps {
  return {
    overview: async () => ({
      ok: true,
      value: {
        bases: [
          {
            ...library,
            documentCount: 1,
            index: {
              status: 'ready',
              chunks: 1,
              completed: 1,
              total: 1,
              error: null,
            },
          },
        ],
        model: { id: 'local-model', status: 'ready', file: '', progress: 100, error: null },
        defaults: library.split,
      },
    }),
    get: vi.fn(async () => ({ ok: true as const, value: library })),
    save: async draft => ({
      ok: true,
      value: { ...draft, revision: draft.revision + 1, updatedAt: 2 },
    }),
    remove: async () => ({ ok: true, value: undefined }),
    reindex: async () => ({
      ok: true,
      value: { status: 'pending', chunks: 0, completed: 0, total: 0, error: null },
    }),
    preview: async () => ({ ok: true, value: [] }),
    search: async () => ({ ok: true, value: { hits: [], skippedBases: [] } }),
    importLegacy: async () => ({ ok: true, value: 0 }),
    legacy: [],
    writable: true,
    t: key => zh[key],
  }
}

it('opens new drafts without fetching an absent library and stays on the list after returning', async () => {
  const props = fixture()
  const confirm = vi.spyOn(window, 'confirm')
  render(<KnowledgePanel {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '新建知识库' }))
  expect(screen.getByLabelText<HTMLInputElement>('名称').value).toBe('')
  expect(props.get).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }))
  fireEvent.click(screen.getByRole('button', { name: '管理知识' }))
  await screen.findByRole('button', { name: '返回知识库' })
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }))
  expect(screen.getByRole('heading', { name: '知识库', level: 1 })).toBeTruthy()
  expect(confirm).not.toHaveBeenCalled()
  expect(props.get).toHaveBeenCalledTimes(1)
})

it('preserves a failed save and blocks search until the current draft is saved', async () => {
  const props = fixture()
  props.save = vi
    .fn<KnowledgePanelProps['save']>()
    .mockResolvedValueOnce({ ok: false, error: { message: '存储失败' } })
    .mockImplementation(async draft => ({
      ok: true,
      value: { ...draft, revision: 2, updatedAt: 2 },
    }))
  render(<KnowledgePanel {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '管理知识' }))
  await screen.findByRole('button', { name: '返回知识库' })
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '修改后的资料' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并建立索引' }))
  expect((await screen.findByRole('alert')).textContent).toBe('存储失败')
  expect(screen.getByLabelText<HTMLInputElement>('名称').value).toBe('修改后的资料')
  fireEvent.click(screen.getByRole('tab', { name: '检索测试' }))
  fireEvent.change(screen.getByRole('textbox', { name: '输入检索问题' }), {
    target: { value: '问题' },
  })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '检索' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保存并建立索引' }))
  await waitFor(() =>{
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '检索' }).disabled).toBe(false) },
  )
  expect(screen.queryByRole('alert')).toBeNull()
})

it('shows index failures and supports rebuilding without changing the saved document', async () => {
  const props = fixture()
  const original = props.overview
  props.overview = async () => {
    const result = await original()
    if (result.ok)
      result.value.bases[0]!.index = {
        status: 'error',
        chunks: 0,
        completed: 0,
        total: 1,
        error: '模型下载失败',
      }
    return result
  }
  props.reindex = vi.fn(props.reindex)
  props.save = vi.fn(props.save)
  render(<KnowledgePanel {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '管理知识' }))
  expect((await screen.findByRole('alert')).textContent).toBe('模型下载失败')
  fireEvent.click(screen.getByRole('button', { name: '重建索引' }))
  await waitFor(() =>{  expect(props.reindex).toHaveBeenCalledWith(library.id) })
  expect(props.save).not.toHaveBeenCalled()
})

it('uses explicit document actions and keeps file input out of the visible layout', async () => {
  const props = fixture()
  const view = render(<KnowledgePanel {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: '管理知识' }))
  await screen.findByRole('button', { name: '返回知识库' })

  const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!
  const inputClick = vi.spyOn(fileInput, 'click')
  fireEvent.click(screen.getByRole('button', { name: '导入文本文件' }))
  expect(inputClick).toHaveBeenCalledOnce()
  expect(fileInput.hidden).toBe(true)
  expect(screen.getByText('4 字符')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '新增知识' }))
  expect(view.container.querySelectorAll('button[aria-pressed]').length).toBe(2)
  expect(screen.getByText('2 篇知识')).toBeTruthy()
})
