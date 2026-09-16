// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { TokenLedger, type TokenLedgerProps } from '../src/client/TokenLedger.tsx'
import { zh } from '../src/client/locales.ts'
import { fixture, live, message, usage } from './fixtures.client.ts'

afterEach(cleanup)

function props(entries: readonly SessionEventLikeEntry[], hasMore = false): TokenLedgerProps {
  const window = { entries, hasMore, revision: 1, change: { kind: 'replace' as const, entries } }
  return {
    useLedgerEvents: selector => selector(window),
    useSession: (selector: (value: { loadingOlder: boolean }) => unknown) => selector({ loadingOlder: false }),
    loadOlder: vi.fn(async () => {}), viewRequest: null, completeViewRequest: vi.fn(),
    t: key => key in zh ? zh[key as keyof typeof zh] : key,
  } as TokenLedgerProps
}

describe('Token trajectory interactions', () => {
  it('selects requests, exposes source content and filters by tool', () => {
    render(<TokenLedger {...props(fixture())} />)
    fireEvent.click(screen.getByRole('button', { name: /轮 1 \/ 步骤 1/ }))
    const inspector = screen.getByRole('complementary')
    expect(within(inspector).getByText('系统提示词', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '工具调用 (1)' }))
    expect(within(inspector).getByText('export const source = 1', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '原始记录' }))
    expect(within(inspector).getByText('tool/result #7', { exact: true })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'read' } })
    expect(screen.getAllByRole('row')).toHaveLength(2)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
    expect(screen.getByText(zh.noMatches)).toBeTruthy()
  })

  it('updates streaming estimates into provider usage without duplicating a request', () => {
    const prefix = fixture().slice(0, 5)
    const view = render(<TokenLedger {...props([...prefix, live(4.1, 'Hello world')])} />)
    expect(screen.getByTitle(zh.liveEstimate).textContent).toBe('~3')
    expect(screen.getByText(zh.streaming)).toBeTruthy()
    view.rerender(<TokenLedger {...props([...prefix, message(5, 1, usage)])} />)
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.queryByText(zh.streaming)).toBeNull()
    expect(within(screen.getByRole('table')).getByText('1,200')).toBeTruthy()
  })

  it('loads older records and does not present partial history as the full total', () => {
    const input = props(fixture(), true)
    render(<TokenLedger {...input} />)
    expect(screen.getByText(zh.partialHistory)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.loadOlder }))
    expect(input.loadOlder).toHaveBeenCalledOnce()
  })

  it('honors a conversation tool focus request', () => {
    const input = props(fixture())
    input.viewRequest = { view: 'trajectory', focus: 'read-1' }
    render(<TokenLedger {...input} />)
    expect(screen.getByRole('tab', { name: '工具调用 (1)' }).getAttribute('aria-selected')).toBe('true')
    expect(input.completeViewRequest).toHaveBeenCalledOnce()
  })
})
