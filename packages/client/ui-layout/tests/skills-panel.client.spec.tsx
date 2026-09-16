// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { SkillsPanel } from '../src/client/authoring/SkillsPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { AuthoringItem } from '../src/authoring-settings.ts'

afterEach(cleanup)
const custom: AuthoringItem = { id: 'cover', title: '文章封面', description: '设计文章封面提示词', enabled: false, category: 'writing', body: '输出构图与提示词', steps: ['读取主题'], updatedAt: 1 }
const upload = (content = '---\nname: cover-assistant\ndescription: Create article covers\n---\nDraft a cover prompt.') => {
  const bytes = zipSync({ 'cover/SKILL.md': strToU8(content), 'cover/references/style.md': strToU8('Style notes') })
  const file = new File([new Uint8Array(bytes)], 'cover.zip', { type: 'application/zip' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  fireEvent.change(screen.getByLabelText('Skill ZIP 压缩包'), { target: { files: [file] } })
}
const setup = (items: AuthoringItem[] = [], save = vi.fn<(_item: AuthoringItem) => Promise<void>>(async () => {})) => {
  const invoke = vi.fn(async () => {})
  render(<SkillsPanel items={items} writable loading={false} save={save} invoke={invoke} t={key => zh[key]} />)
  return { invoke, save }
}

describe('Skill marketplace', () => {
  it('filters built-in and custom skills by category and search, and clears an empty result', () => {
    setup([custom])
    expect(screen.getAllByRole('article')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '内容创作' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: '文章封面' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } })
    expect(screen.getByText('没有找到匹配的 Skill')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    fireEvent.click(screen.getByRole('button', { name: '内置精选' }))
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('opens built-in instructions and passes their exact registered name to chat', async () => {
    const { invoke } = setup()
    fireEvent.click(screen.getByRole('button', { name: '创建工作流' }))
    const dialog = screen.getByRole('dialog', { name: '创建工作流' })
    expect(within(dialog).getByText(zh['builtin.workflow.step1'])).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '用于对话' }))
    await waitFor(() => { expect(invoke).toHaveBeenCalledWith('make-workflow') })
  })

  it('keeps disabled skills editable but prevents using them in chat', () => {
    setup([custom])
    fireEvent.click(screen.getByRole('button', { name: '我的 Skill' }))
    expect((screen.getByRole('button', { name: '用于对话' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑 Skill' }))
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe(custom.title)
    expect((screen.getByLabelText('分类') as HTMLSelectElement).value).toBe('writing')
  })

  it('previews an upload, retains it after a failed save and commits resources on retry', async () => {
    const save = vi.fn<(_item: AuthoringItem) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    setup([], save)
    expect(screen.queryByRole('button', { name: '新建 Skill' })).toBeNull()
    upload()
    await screen.findByRole('heading', { name: '导入 Skill' })
    expect(screen.getByText('references/style.md')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '封面助手' } })
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'writing' } })
    fireEvent.change(screen.getByPlaceholderText('步骤...'), { target: { value: '读取主题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加步骤' }))
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('保存失败，请重试') })
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('封面助手')
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }))
    await waitFor(() => { expect(screen.getByRole('heading', { name: '技能广场' })).toBeTruthy() })
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'imported-cover-assistant', title: '封面助手', category: 'writing', steps: ['读取主题'], archive: expect.any(String) }))
  })

  it('rejects invalid metadata without saving and allows retrying the upload', async () => {
    const { save } = setup()
    upload('not a Skill')
    await screen.findByText(zh['skill.importError.invalidMetadata'])
    expect(save).not.toHaveBeenCalled()
    upload()
    await screen.findByRole('heading', { name: '导入 Skill' })
    fireEvent.click(screen.getByRole('button', { name: '返回技能广场' }))
    expect(screen.getByRole('heading', { name: '技能广场' })).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('requires confirmation to update a same-name import and preserves its disabled state', async () => {
    const { save } = setup([{ ...custom, id: 'imported-cover-assistant' }])
    upload()
    await screen.findByRole('heading', { name: '导入 Skill' })
    expect(screen.getByText(zh['skill.replaceNotice'])).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '更新已有 Skill' }))
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'imported-cover-assistant', enabled: false })) })
  })

  it('disables explicit invocation for model-only imports', () => {
    setup([{ ...custom, enabled: true, invocation: { modelInvocable: true, userInvocable: false } }])
    fireEvent.click(screen.getByRole('button', { name: '我的 Skill' }))
    expect((screen.getByRole('button', { name: '用于对话' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
