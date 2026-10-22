/** Think row: a live indicator while reasoning streams, a readable disclosure after. */
import { useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

const NOOP = (): void => {}

export interface ReasoningRowProps {
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
  /** Reasoning text accumulated for this step; empty when nothing arrived. */
  text?: string | undefined
  /** True while the step is still streaming. */
  running: boolean
}

/**
 * Render one step's reasoning.
 *
 * While the step streams, the row is a content-free signal that the model is
 * still thinking, because the text is still growing. Once the step settles the
 * row becomes a disclosure whose body is that step's reasoning, so a reader can
 * check how a conclusion was reached without leaving the transcript or opening
 * the Token trace. An empty reasoning text keeps the live-only shape: a
 * disclosure with nothing inside would be a control that does nothing.
 * @param props - locale seat, reasoning text, and the streaming flag.
 * @returns the live row, the collapsible finished row, or null when there is nothing to show.
 */
export function ReasoningRow({ t, text, running }: ReasoningRowProps) {
  const [open, setOpen] = useState(false)
  const body = text?.trim() ?? ''
  if (running) {
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
  if (body === '') return null
  return (
    <div className={css.root} data-variant="think" data-state="done">
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={<IconThinkOutline14 size={14} />}
        title={t('message.thought')}
        open={open}
        expandable
        onToggle={() => { setOpen(current => !current) }}
      />
      {open && <div className={css.body}>{body}</div>}
    </div>
  )
}
