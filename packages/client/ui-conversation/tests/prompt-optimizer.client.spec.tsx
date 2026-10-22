// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { PromptOptimizer } from '../src/client/skeleton/PromptOptimizer.tsx'

afterEach(cleanup)

const t = makeTranslate(zh)

describe('PromptOptimizer', () => {
  it('calls the selected model and applies the editable result', async () => {
    const onApply = vi.fn()
    const optimizePrompt = vi.fn(async (draft: string, mode: string) => ({
      ok: true as const,
      value: { text: `[${mode}] ${draft}，请补充验收标准` },
    }))
    const view = render(
      <PromptOptimizer
        draft="修复登录"
        disabled={false}
        optimizePrompt={optimizePrompt}
        onApply={onApply}
        t={t}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '优化提示词' }))
    await waitFor(() => { expect((view.getByRole('textbox', { name: '优化后的提示词' }) as HTMLTextAreaElement).value).toBe('[general] 修复登录，请补充验收标准') })
    expect(optimizePrompt).toHaveBeenCalledWith('修复登录', 'general', expect.any(AbortSignal))

    fireEvent.change(view.getByRole('textbox', { name: '优化后的提示词' }), { target: { value: '自定义提示词' } })
    fireEvent.click(view.getByRole('button', { name: '应用到输入框' }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith('自定义提示词')
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('cancels a previous request when the mode changes', async () => {
    const requests: Array<{ mode: string; signal: AbortSignal }> = []
    const first = Promise.withResolvers<{ ok: true; value: { text: string } }>()
    const optimizePrompt = vi.fn((draft: string, mode: string, signal?: AbortSignal) => {
      requests.push({ mode, signal: signal as AbortSignal })
      return requests.length === 1
        ? first.promise
        : Promise.resolve({ ok: true as const, value: { text: `${draft}-${mode}` } })
    })
    const view = render(
      <PromptOptimizer draft="整理需求" disabled={false} optimizePrompt={optimizePrompt} onApply={() => {}} t={t} />,
    )
    fireEvent.click(view.getByRole('button', { name: '优化提示词' }))
    await waitFor(() => { expect(optimizePrompt).toHaveBeenCalledOnce() })
    fireEvent.click(view.getByRole('button', { name: '代码开发' }))
    await waitFor(() => { expect(optimizePrompt).toHaveBeenCalledTimes(2) })
    expect(requests[0]!.signal.aborted).toBe(true)
    expect(requests[1]!.mode).toBe('code')
  })

  it('shows a retry action after a model failure', async () => {
    const optimizePrompt = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: new Error('model unavailable') })
      .mockResolvedValueOnce({ ok: true as const, value: { text: '重试后的提示词' } })
    const view = render(
      <PromptOptimizer draft="任务" disabled={false} optimizePrompt={optimizePrompt} onApply={() => {}} t={t} />,
    )
    fireEvent.click(view.getByRole('button', { name: '优化提示词' }))
    expect((await view.findByRole('alert')).textContent).toContain('model unavailable')
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect((view.getByRole('textbox', { name: '优化后的提示词' }) as HTMLTextAreaElement).value).toBe('重试后的提示词') })
  })

  it('copies the model result and reports the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const optimizePrompt = vi.fn(async () => ({ ok: true as const, value: { text: '优化结果' } }))
    const view = render(
      <PromptOptimizer draft="整理需求" disabled={false} optimizePrompt={optimizePrompt} onApply={() => {}} t={t} />,
    )
    fireEvent.click(view.getByRole('button', { name: '优化提示词' }))
    await waitFor(() => { expect((view.getByRole('textbox', { name: '优化后的提示词' }) as HTMLTextAreaElement).value).toBe('优化结果') })
    fireEvent.click(view.getByRole('button', { name: '复制' }))
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledOnce()
    expect(view.getByRole('button', { name: '已复制' })).toBeTruthy()
  })

  it('keeps the trigger unavailable for locked or empty input', () => {
    const optimizePrompt = vi.fn(async () => ({ ok: true as const, value: { text: '结果' } }))
    const locked = render(
      <PromptOptimizer draft="任务" disabled optimizePrompt={optimizePrompt} onApply={() => {}} t={t} />,
    )
    expect((locked.getByRole('button', { name: '优化提示词' }) as HTMLButtonElement).disabled).toBe(true)
    locked.unmount()
    const empty = render(
      <PromptOptimizer draft=" " disabled={false} optimizePrompt={optimizePrompt} onApply={() => {}} t={t} />,
    )
    expect((empty.getByRole('button', { name: '优化提示词' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
