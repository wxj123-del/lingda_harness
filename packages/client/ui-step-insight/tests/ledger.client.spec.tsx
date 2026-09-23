// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { TokenLedger, type TokenLedgerProps } from '../src/client/TokenLedger.tsx'
import { zh } from '../src/client/locales.ts'
import { entry, fixture, live, message, usage } from './fixtures.client.ts'

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

  it('renders a live context map from the latest model-visible request', () => {
    render(<TokenLedger {...props(fixture())} />)
    const preview = screen.getByRole('region', { name: zh.contextPreview })
    expect(preview.textContent).toContain(zh.contextPreviewLive)
    expect(preview.textContent).toContain(zh.system)
    expect(preview.textContent).toContain(zh.user)
    expect(preview.textContent).toContain(zh.tool)
    expect(preview.textContent).toContain(zh.schema)
    expect(preview.querySelector('[role="img"]')).not.toBeNull()
    expect(preview.querySelectorAll('[data-kind]').length).toBeGreaterThan(3)
    expect(preview.textContent).toContain('You audit requests.')
    expect(preview.textContent).toContain('Inspect the source')
  })

  it('renders the router-selected snapshot instead of the whole reconstructed surface', () => {
    const events = fixture()
    const system = (events[2] as { event: { data: { message: { id: unknown } } } }).event.data.message
    const user = (events[3] as { event: { data: { id: unknown } } }).event.data
    events.splice(10, 0, {
      ...events[10],
      event: {
        ...events[10]!.event,
        seq: 9.5 as never,
        type: 'context/router',
        data: {
          turn: 1, step: 2, scope: 'recent', reason: 'fixture route',
          signal: 'lexical-match',
          inputMessages: 4, outputMessages: 2, droppedMessages: 2,
          estimatedInputTokens: 20, estimatedRequestTokens: 28, estimatedWindowTokens: 60, requestOverflowTokens: 12,
          taskId: 'task-1', taskRecallMessages: 1,
          budgetExceeded: true, overflowTokens: 4,
          selectedMessageIds: [String(system.id), String(user.id)],
        },
      },
    } as never)
    render(<TokenLedger {...props(events)} />)
    const preview = screen.getByRole('region', { name: zh.contextPreview })
    expect(preview.textContent).toContain('You audit requests.')
    expect(preview.textContent).toContain('Inspect the source')
    expect(preview.textContent).not.toContain('export const source = 1')
    fireEvent.click(screen.getByRole('button', { name: /轮 1 \/ 步骤 2/ }))
    expect(within(screen.getByRole('complementary')).getByText(zh.contextBudgetExceeded, { exact: false })).toBeTruthy()
    expect(within(screen.getByRole('complementary')).getByText(zh.contextRequestOverflow, { exact: false })).toBeTruthy()
    expect(within(screen.getByRole('complementary')).getByText(zh.contextTaskRecall, { exact: false })).toBeTruthy()
    expect(screen.getByRole('region', { name: zh.contextMetrics })).toBeTruthy()
    expect(screen.getByRole('region', { name: zh.contextMetrics }).textContent).toContain(zh.contextSignalLexicalMatch)
  })

  it('labels policy preprocessing and warns when preview content was transformed', () => {
    const events = fixture()
    events.splice(10, 0, entry(9.5, 'agent/request-context', {
      turn: 1, step: 2, mode: 'qa', maxSteps: 0, usedSteps: 0,
      inputMessages: 4, outputMessages: 3, clippedToolResults: 1, droppedMessages: 0,
      estimatedInputTokens: 24,
    }), entry(9.6, 'context/router', {
      turn: 1, step: 2, scope: 'task', reason: 'fixture route',
      inputMessages: 4, outputMessages: 3, droppedMessages: 1,
      estimatedInputTokens: 20, estimatedRequestTokens: 24,
      budgetExceeded: false, overflowTokens: 0, selectedMessageIds: [],
    }))
    render(<TokenLedger {...props(events)} />)
    expect(screen.getByRole('region', { name: zh.contextPreview }).textContent).toContain(zh.contextPreviewTransformed)
    fireEvent.click(screen.getByRole('button', { name: /轮 1 \/ 步骤 2/ }))
    expect(within(screen.getByRole('complementary')).getByText(zh.contextPolicy, { exact: false })).toBeTruthy()
  })

  it('renders bounded final message metadata when the router records it', () => {
    const events = fixture()
    const system = (events[2] as { event: { data: { message: { id: unknown } } } }).event.data.message
    const user = (events[3] as { event: { data: { id: unknown } } }).event.data
    events.splice(10, 0, entry(9.5, 'context/router', {
      turn: 1, step: 2, scope: 'recent', reason: 'fixture route',
      inputMessages: 4, outputMessages: 2, droppedMessages: 2,
      estimatedInputTokens: 20, estimatedRequestTokens: 39,
      budgetExceeded: false, overflowTokens: 0,
      selectedMessageIds: [String(system.id), String(user.id)],
      selectedMessageMetaOmitted: 2,
      selectedMessageMeta: [
        { id: String(system.id), kind: 'system', sourceKind: 'system', estimatedTokens: 5, preview: 'Final system snapshot' },
        { id: String(user.id), kind: 'user', sourceKind: 'user', estimatedTokens: 6, preview: 'Final transformed request' },
      ],
    }))
    render(<TokenLedger {...props(events)} />)
    const preview = screen.getByRole('region', { name: zh.contextPreview })
    expect(preview.textContent).toContain('Final transformed request')
    expect(preview.textContent).toContain(zh.contextPreviewMetadataTruncated)
    expect(preview.textContent).not.toContain('Inspect the source')
  })
})
