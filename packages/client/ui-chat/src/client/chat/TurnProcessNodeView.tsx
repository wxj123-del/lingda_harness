import { memo, useEffect, useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import css from './TurnProcessNodeView.module.css'

/** Turn-level process disclosure controller. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = turnProcess.open
  const labels: string[] = []
  const location = node.location
  const startedAt = location.kind === 'turn' ? location.turn.start?.time : undefined
  const endedAt = location.kind === 'turn' ? location.turn.end?.time : undefined
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startedAt === undefined || endedAt !== undefined) return
    const id = window.setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { window.clearInterval(id) }
  }, [endedAt, startedAt])
  const runMs = startedAt === undefined
    ? undefined
    : Math.max(0, (endedAt ?? now) - startedAt)
  if (!turnProcess.foldable) return null
  const durationLabel = runMs === undefined
    ? null
    : t('message.ranFor', { duration: formatRunDuration(runMs, t) })
  if (node.data.toolCallCount > 0) {
    labels.push(t(
      node.data.toolCallCount === 1
        ? 'message.turnProcess.toolCalls.one'
        : 'message.turnProcess.toolCalls.other',
      { count: node.data.toolCallCount },
    ))
  }
  if (node.data.messageCount > 0) {
    labels.push(t(
      node.data.messageCount === 1
        ? 'message.turnProcess.messages.one'
        : 'message.turnProcess.messages.other',
      { count: node.data.messageCount },
    ))
  }
  if (node.data.subagentCount > 0) {
    labels.push(t(
      node.data.subagentCount === 1
        ? 'message.turnProcess.subagents.one'
        : 'message.turnProcess.subagents.other',
      { count: node.data.subagentCount },
    ))
  }
  const label = labels.length === 0
    ? t('message.turnProcess.thoughtForAWhile')
    : labels.join(t('message.turnProcess.separator'))
  return (
    <button
      type="button"
      className={css.root}
      data-open={open || undefined}
      data-turn-process={node.data.turn}
      data-turn-process-messages={node.data.messageCount}
      data-turn-process-tool-calls={node.data.toolCallCount}
      data-turn-process-subagents={node.data.subagentCount}
      aria-expanded={open}
      onClick={(event) => {
        event.currentTarget.focus()
        turnProcess.setOpen(!open)
      }}
    >
      {durationLabel !== null && <span className={css.duration} aria-hidden>{durationLabel}</span>}
      <span className={css.label}>{label}</span>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )
})
