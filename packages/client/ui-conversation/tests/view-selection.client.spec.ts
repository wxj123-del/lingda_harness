import { describe, expect, it } from 'vitest'
import { resolveActiveView, splitViewTabs } from '../src/client/view-selection.ts'
import type { ViewTab } from '../src/client/contract/views.ts'

describe('resolveActiveView', () => {
  it('resolves the preferred registered View and Chat fallback', () => {
    const tabs: readonly ViewTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'custom', label: 'Custom' },
    ]

    expect(resolveActiveView(tabs, 'custom')?.id).toBe('custom')
    expect(resolveActiveView(tabs, 'removed')?.id).toBe('chat')
    expect(resolveActiveView(tabs, null)?.id).toBe('chat')
  })

  it('does not choose an arbitrary registered View', () => {
    expect(resolveActiveView([{ id: 'custom', label: 'Custom' }], null)).toBeUndefined()
  })
})

describe('splitViewTabs', () => {
  const many: readonly ViewTab[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'trajectory', label: 'Trajectory' },
    { id: 'map', label: 'Map' },
    { id: 'repository', label: 'Repository' },
    { id: 'workflow', label: 'Workflow' },
    { id: 'terminal', label: 'Terminal' },
  ]

  it('keeps every tab inline while the list fits', () => {
    const tabs = many.slice(0, 3)
    expect(splitViewTabs(tabs, 'chat', 3)).toEqual({ inline: tabs, overflow: [] })
  })

  it('moves the remainder into the overflow in registration order', () => {
    const split = splitViewTabs(many, 'chat', 3)
    expect(split.inline.map(tab => tab.id)).toEqual(['chat', 'trajectory', 'map'])
    expect(split.overflow.map(tab => tab.id)).toEqual(['repository', 'workflow', 'terminal'])
  })

  it('keeps a selected tab inline even when registration order would hide it', () => {
    const split = splitViewTabs(many, 'terminal', 3)
    expect(split.inline.map(tab => tab.id)).toEqual(['chat', 'trajectory', 'terminal'])
    expect(split.overflow.map(tab => tab.id)).toEqual(['map', 'repository', 'workflow'])
  })

  it('keeps the chat fallback inline when no selection resolves', () => {
    const split = splitViewTabs(many, undefined, 2)
    expect(split.inline.map(tab => tab.id)).toEqual(['chat', 'trajectory'])
    expect(split.overflow).toHaveLength(4)
  })

  it('fills from the front when chat is not registered', () => {
    const split = splitViewTabs(many.slice(1), 'removed', 2)
    expect(split.inline.map(tab => tab.id)).toEqual(['trajectory', 'map'])
    expect(split.overflow.map(tab => tab.id)).toEqual(['repository', 'workflow', 'terminal'])
  })
})
