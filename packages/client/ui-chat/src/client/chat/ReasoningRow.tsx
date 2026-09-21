/** Live Think indicator for the streaming reasoning tail of one Assistant step. */
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

const NOOP = (): void => {}

/**
 * Render the transcript's content-free Think row. Reasoning prose is
 * trace-only — the complete text stays available in the Token trace detail — so
 * this row only signals that the model is still thinking; it disappears as soon
 * as the step settles or the next block arrives.
 * @param props.t - conversation locale seat for the running status.
 * @returns the live Think row.
 */
export function ReasoningRow({ t }: { t: ChatViewSlotProps['t'] }) {
  return (
    <div className={css.root} data-variant="think" data-state="running">
      <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={<IconThinkOutline14 size={14} />}
        title={t('message.think')}
        open={false}
        expandable={false}
        onToggle={NOOP}
      />
    </div>
  )
}
