import type { ViewTab } from './contract/views.ts'

const DEFAULT_VIEW_ID = 'chat'

/**
 * View tabs rendered directly in the header before the remainder move into its
 * overflow menu. A Session registering more Views than this keeps its header
 * one row wide instead of growing a tab per plugin.
 */
export const INLINE_VIEW_LIMIT = 3

/** Inline/overflow split of the registered View tabs. */
export interface ViewTabSplit {
  /** Tabs rendered as header tabs, in registration order. */
  readonly inline: readonly ViewTab[]
  /** Tabs reachable only through the overflow menu, in registration order. */
  readonly overflow: readonly ViewTab[]
}

/**
 * Split the View tabs for a header that shows at most `limit` of them.
 *
 * Chat is the primary view and a selected View must never lose its own
 * indicator, so both are kept inline ahead of registration order; the
 * remaining slots fill from the front. Everything else stays reachable through
 * the overflow menu, so no registration becomes unreachable.
 * @param tabs - currently registered Views in slot order.
 * @param activeId - the resolved active View's id, when one is selected.
 * @param limit - maximum tabs rendered inline.
 * @returns the inline tabs and the overflow remainder, both in slot order.
 */
export function splitViewTabs(
  tabs: readonly ViewTab[],
  activeId: string | undefined,
  limit: number,
): ViewTabSplit {
  if (tabs.length <= limit) return { inline: tabs, overflow: [] }
  const keep = new Set<string>()
  const chat = tabs.find(tab => tab.id === DEFAULT_VIEW_ID)
  if (chat !== undefined) keep.add(chat.id)
  if (activeId !== undefined && tabs.some(tab => tab.id === activeId)) keep.add(activeId)
  for (const tab of tabs) {
    if (keep.size >= limit) break
    keep.add(tab.id)
  }
  return {
    inline: tabs.filter(tab => keep.has(tab.id)),
    overflow: tabs.filter(tab => !keep.has(tab.id)),
  }
}

/**
 * Resolve a preferred registered View, then Chat, without choosing another View.
 * @param tabs - currently registered Views.
 * @param selectedId - preferred View identity, when one is stored.
 * @returns the selected View, Chat fallback, or undefined when neither is registered.
 */
export function resolveActiveView(
  tabs: readonly ViewTab[],
  selectedId: string | null,
): ViewTab | undefined {
  const selected = selectedId === null ? undefined : tabs.find(view => view.id === selectedId)
  return selected ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}
