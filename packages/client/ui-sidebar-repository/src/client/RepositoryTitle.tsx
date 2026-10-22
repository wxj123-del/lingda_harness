/**
 * The source-control type's chip title: the branch glyph before the type's
 * label, so the tab reads as source control at a glance.
 */
import type { ReactNode } from 'react'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RepositoryBody.module.css'

/** No stable title element exists in the primitives yet; the glyph plus the captured title is the chip. */
export function RepositoryTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return (
    <>
      <IconBranchOutline16 size={14} className={css.titleIcon} />
      {tab.title}
    </>
  )
}
