/** Live visual map of the latest model-visible request context. */

import { useMemo } from 'react'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { StepRow, InputPart } from './types.ts'
import type { Translate } from './locales.ts'
import { inspectInput } from './input-parts.ts'
import { number } from './format.ts'
import css from './ledger.module.css'

interface ContextPreviewProps {
  row: StepRow | undefined
  window: SessionEventWindow
  t: Translate
}

const KIND_ORDER: readonly InputPart['kind'][] = ['system', 'context', 'user', 'assistant', 'tool', 'schema', 'unknown']

function previewText(part: InputPart): string {
  const compact = part.text.replace(/\s+/gu, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact
}

function sourceText(part: InputPart): string {
  if (part.kind === 'schema' && part.schema !== undefined) return part.schema.name
  if (part.source === '') return ''
  try {
    const source = JSON.parse(part.source) as { kind?: unknown; plugin?: unknown; callId?: unknown }
    if (typeof source.kind === 'string' && typeof source.plugin === 'string') return `${source.kind} / ${source.plugin}`
    if (typeof source.kind === 'string' && typeof source.callId === 'string') return `${source.kind} / ${source.callId}`
    if (typeof source.kind === 'string') return source.kind
  } catch { /* older producers may store non-JSON source labels */ }
  return part.source
}

/** Render the latest request's recoverable input as a proportional map and source list. */
export function ContextPreview({ row, window, t }: ContextPreviewProps) {
  const input = useMemo(
    () => row === undefined ? { parts: [], incomplete: false, unsupported: false } : inspectInput(window.entries, row, window.hasMore),
    [row, window],
  )
  if (row === undefined || input.parts.length === 0) return null

  const selectedIds = row.contextRoute?.selectedMessageIds === undefined
    ? undefined
    : new Set(row.contextRoute.selectedMessageIds)
  const routedParts = selectedIds === undefined
    ? input.parts
    : input.parts.filter(part => part.kind === 'schema' || (part.messageId !== undefined && selectedIds.has(part.messageId)))
  const auditedParts = row.contextRoute?.selectedMessageMeta?.map((message, index) => ({
    id: `audit:${message.id}`,
    messageId: message.id,
    seq: index,
    kind: message.kind,
    source: message.sourceKind,
    text: message.preview,
    tokens: message.estimatedTokens,
    media: false,
  } satisfies InputPart))
  const finalParts = auditedParts === undefined
    ? routedParts
    : [...auditedParts, ...routedParts.filter(part => part.kind === 'schema')]
  const transformed = row.context !== undefined && (row.context.clippedToolResults > 0 || (row.context.deduplicatedMessages ?? 0) > 0)
  const omittedMetadata = row.contextRoute?.selectedMessageMetaOmitted ?? 0
  const totalTokens = row.contextRoute?.estimatedRequestTokens
    ?? finalParts.reduce((sum, part) => sum + part.tokens, 0)
  const grouped = KIND_ORDER.map((kind) => {
    const parts = finalParts.filter(part => part.kind === kind)
    return { kind, count: parts.length, tokens: parts.reduce((sum, part) => sum + part.tokens, 0) }
  }).filter(group => group.count > 0)

  return <section className={css.contextPreview} aria-label={t('contextPreview')} data-context-preview="">
    <header className={css.contextPreviewHeader}>
      <div>
        <h3>{t('contextPreview')}</h3>
      </div>
      <span className={css.contextPreviewLive}>{t('contextPreviewLive')}</span>
    </header>
    <div className={css.contextPreviewMap} role="img" aria-label={`${t('contextPreviewTotal')} ~${number(totalTokens)} ${t('token')}`}>
      {finalParts.map(part => <span
        key={part.id}
        className={css.contextPreviewSegment}
        data-kind={part.kind}
        title={`${t(part.kind)} #${part.seq} ~${number(part.tokens)} ${t('token')}`}
        style={{ width: `${totalTokens === 0 ? 0 : Math.max(part.tokens / totalTokens * 100, 0.35)}%` }}
        aria-hidden
      />)}
    </div>
    <div className={css.contextPreviewLegend}>
      {grouped.map(group => <span key={group.kind} data-kind={group.kind}>
        <i aria-hidden />{t(group.kind)} {group.count} · ~{number(group.tokens)}
      </span>)}
      <strong>~{number(totalTokens)} {t('token')}</strong>
    </div>
    {(input.incomplete || input.unsupported) && <p className={css.contextPreviewNotice}>{t('contextPreviewIncomplete')}</p>}
    {omittedMetadata > 0 && <p className={css.contextPreviewNotice}>{t('contextPreviewMetadataTruncated')} {omittedMetadata}.</p>}
    {transformed && <p className={css.contextPreviewNotice}>{t('contextPreviewTransformed')}</p>}
    <div className={css.contextPreviewList}>
      {finalParts.map((part) => {
        const source = sourceText(part)
        return <div className={css.contextPreviewItem} key={part.id}>
          <span className={css.contextPreviewKind} data-kind={part.kind}>{t(part.kind)}</span>
          <span className={css.contextPreviewContent} title={part.text}>{previewText(part)}</span>
          <span className={css.contextPreviewMeta}>{source}{source === '' ? '' : ' · '}~{number(part.tokens)}</span>
        </div>
      })}
    </div>
  </section>
}
