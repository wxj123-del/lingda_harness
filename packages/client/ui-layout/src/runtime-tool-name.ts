/** Stable registration name shared by authoring and the tool catalog. */
import type { AuthoringItem } from './authoring-settings.ts'

/**
 * Resolve a user-authored item's registered tool name.
 * @param kind - Authoring collection that owns the item.
 * @param item - Item whose stable id supplies the name.
 * @returns Model-visible name used by the Host registry.
 */
export function runtimeToolName(kind: string, item: AuthoringItem): string {
  const stableId = item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return `user_${kind}_${stableId.replace(/^-+|-+$/g, '') || 'item'}`
}
