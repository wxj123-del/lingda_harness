/**
 * Stage one of this package's registration: what the `repository` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page offers
 * it as an entry box, and the body opens changes through the owner's
 * `tabActions.openResource` for a file viewer to claim.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** The tab kind this package owns. */
export const REPOSITORY_KIND = 'repository'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const REPOSITORY_ID = '@deepseek-ai/dsh-client-ui-sidebar-repository'

/**
 * The source-control type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function repositoryDefinition(t: TranslateNS<'sidebarRepository'>): SidebarRightTabDefinition {
  return {
    id: REPOSITORY_ID,
    kind: REPOSITORY_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'source-control',
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconBranchOutline16,
    }],
  }
}
