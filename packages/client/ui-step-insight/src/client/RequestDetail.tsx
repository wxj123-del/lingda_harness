/** Selected request accounting and inspectable source content. */
import { useRef, useState } from 'react'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { StepRow } from './types.ts'
import type { Translate } from './locales.ts'
import { inspectInput } from './input-parts.ts'
import { contentText, estimateText, hasMedia } from './usage.ts'
import { accounted, number, rowLabel } from './format.ts'
import { ToolSimilarityList } from './ToolSimilarityList.tsx'
import { GitWorkspaceView } from './GitWorkspaceView.tsx'
import css from './ledger.module.css'

interface DetailProps {
  row: StepRow
  window: SessionEventWindow
  t: Translate
  initialTab?: 'inputTab' | 'toolsTab'
}

/** @param props - selected row and authoritative loaded events. @returns Local request inspector. */
export function RequestDetail({ row, window, t, initialTab = 'inputTab' }: DetailProps) {
  const [tab, setTab] = useState<'inputTab' | 'outputTab' | 'toolsTab' | 'rawTab'>(initialTab)
  const cached = useRef<{ window: SessionEventWindow; before: number; input: ReturnType<typeof inspectInput> }>()
  let previous = cached.current
  if (previous === undefined || previous.before !== row.inputBeforeSeq
    || (previous.window !== window && (window.change.kind !== 'append'
      || row.inputBeforeSeq === Infinity || window.revision !== previous.window.revision + 1))) {
    previous = { window, before: row.inputBeforeSeq, input: inspectInput(window.entries, row, window.hasMore) }
  } else previous.window = window
  cached.current = previous
  const input = previous.input
  const usage = row.usage
  const duration = row.startTime === null || row.endTime === null ? null : row.endTime - row.startTime
  const ttft = row.startTime === null || row.firstTokenTime === null ? null : row.firstTokenTime - row.startTime
  const decode = row.firstTokenTime === null || row.endTime === null ? null : row.endTime - row.firstTokenTime
  const rate = decode !== null && decode > 0 && usage.output !== null ? usage.output * 1000 / decode : null
  const routeOverflow = row.contextRoute?.requestOverflowTokens ?? row.contextRoute?.overflowTokens
  const metrics = [
    ['uncached', usage.input], ['cache', usage.cacheRead], ['cacheWrite', usage.cacheWrite],
    ['unknownInput', usage.unclassified], ['input', usage.prompt], ['output', usage.output],
    ['reasoning', usage.reasoning], ['total', usage.total],
  ] as const
  return <aside className={css.detail} aria-label={t('select')} data-token-detail="">
    <header className={css.detailHeader}>
      <h3>{rowLabel(row, t)}</h3>
      <span className={css.muted}>{row.provider ?? t('unreported')} / {row.model ?? t('unreported')}</span>
      <span className={css.muted}>{t('event')} #{row.seq}{row.endSeq === undefined ? '' : ` → #${row.endSeq}`}</span>
    </header>
    <dl className={css.accounting}>
      {metrics.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd title={value === null ? t('unreported') : t('reported')}>{key === 'total' ? accounted(value, usage.minimumTotal) : key === 'input' ? accounted(value, usage.minimumPrompt) : number(value)}</dd></div>)}
      <div><dt>{t('duration')}</dt><dd>{number(duration)} {t('milliseconds')}</dd></div>
      <div><dt>{t('firstToken')}</dt><dd>{number(ttft)} {t('milliseconds')}</dd></div>
      <div><dt>{t('throughput')}</dt><dd>{number(rate)}</dd></div>
      <div><dt>{t('cacheRate')}</dt><dd>{number(usage.prompt !== null && usage.prompt > 0 && usage.cacheRead !== null ? usage.cacheRead / usage.prompt * 100 : null)}%</dd></div>
    </dl>
    {row.error !== undefined && <p role="alert" className={css.notice}>{row.error}</p>}
    {row.context !== undefined && <p className={css.requestAudit}>
      <b>{t('mode')}</b> {t(row.context.mode === 'qa' ? 'modeQa' : row.context.mode === 'research' ? 'modeResearch' : row.context.mode === 'coding' ? 'modeCoding' : 'modeExecution')}
      {' · '}{t('toolBudget')} {row.context.usedSteps}/{row.context.maxSteps}
      {' · '}{t('contextMessages')} {row.context.outputMessages}/{row.context.inputMessages}
      {(row.context.droppedMessages > 0 || row.context.clippedToolResults > 0)
        && ` · ${t('contextTrimmed')} ${row.context.droppedMessages} / ${row.context.clippedToolResults}`}
      {row.context.deduplicatedMessages !== undefined && row.context.deduplicatedMessages > 0
        && ` · ${t('deduplicated')} ${row.context.deduplicatedMessages}`}
    </p>}
    {row.contextRoute !== undefined && <p className={css.requestAudit}>
      <b>{t('contextRoute')}</b> {t(row.contextRoute.scope === 'fresh' ? 'contextRouteFresh' : row.contextRoute.scope === 'recent' ? 'contextRouteRecent' : row.contextRoute.scope === 'task' ? 'contextRouteTask' : 'contextRouteFull')}
      {row.contextRoute.signal !== undefined && <> {' · '}<code>{row.contextRoute.signal}</code></>}
      {' · '}{row.contextRoute.reason}{' · '}{t('contextMessages')} {row.contextRoute.outputMessages}/{row.contextRoute.inputMessages}
      {row.contextRoute.maxInputTokens !== undefined && <> {' · '}{t('contextBudget')} ~{number(row.contextRoute.maxInputTokens)}</>}
      {row.contextRoute.estimatedRequestTokens !== undefined && <> {' · '}{t('contextEstimatedInput')} ~{number(row.contextRoute.estimatedRequestTokens)}</>}
      {row.contextRoute.estimatedWindowTokens !== undefined && <> {' · '}{t('contextEstimatedWindow')} ~{number(row.contextRoute.estimatedWindowTokens)}</>}
      {row.contextRoute.estimateBasis !== undefined && <> {' · '}{t(row.contextRoute.estimateBasis === 'heuristic+reserve' ? 'contextEstimateReserved' : 'contextEstimateHeuristic')}</>}
      {row.contextRoute.safetyReserveTokens !== undefined && row.contextRoute.safetyReserveTokens > 0 && <> {' · '}{t('contextSafetyReserve')} ~{number(row.contextRoute.safetyReserveTokens)}</>}
      {row.contextRoute.providerReportedInputTokens !== undefined && <> {' · '}{t('contextProviderReported')} ~{number(row.contextRoute.providerReportedInputTokens)}</>}
      {row.contextRoute.calibrationSampleCount !== undefined && <> {' · '}{t('contextCalibration')} {number(row.contextRoute.calibrationSampleCount)}</>}
      {row.contextRoute.taskId !== undefined && <> {' · '}{t('contextTaskRecall')} {number(row.contextRoute.taskRecallMessages ?? 0)}</>}
      {row.contextRoute.contextWindow !== undefined && <> {' · '}{t('contextWindow')} ~{number(row.contextRoute.contextWindow)}</>}
      {row.contextRoute.budgetExceeded && <span className={css.contextBudgetWarning} role="alert">{' · '}{t('contextBudgetExceeded')} {row.contextRoute.requestOverflowTokens !== undefined ? t('contextRequestOverflow') : t('contextBudgetOverflow')} ~{number(routeOverflow)} {t('token')}</span>}
    </p>}
    {row.context?.estimatedInputTokens !== undefined && <div className={css.contextBreakdown}>
      <b>{t(row.contextRoute === undefined ? 'contextFinal' : 'contextPolicy')} · {t('contextBreakdown')}</b>
      <div className={css.contextBreakdownGrid}>
        <span>{t('contextSystem')} <strong>~{number(row.context.systemPromptTokens ?? 0)}</strong></span>
        <span>{t('contextSchema')} <strong>~{number(row.context.toolSchemaTokens ?? 0)}</strong></span>
        <span>{t('contextHistory')} <strong>~{number(row.context.historyTokens ?? 0)}</strong></span>
        <span>{t('contextKnowledge')} <strong>~{number(row.context.knowledgeBaseTokens ?? 0)}</strong></span>
        <span>{t('contextSkills')} <strong>~{number(row.context.skillTokens ?? 0)}</strong></span>
        <span>{t('contextToolResults')} <strong>~{number(row.context.toolResultTokens ?? 0)}</strong></span>
        <span>{t('contextEstimatedInput')} <strong>~{number(row.context.estimatedInputTokens)}</strong></span>
        {row.context.outputBudgetTokens !== undefined && <span>{t('contextOutputBudget')} <strong>~{number(row.context.outputBudgetTokens)}</strong></span>}
      </div>
    </div>}
    {row.context?.hiddenTools !== undefined && row.context.hiddenTools.length > 0 && <section className={css.requestAudit}>
      <b>{t('hiddenTools')}</b>
      <ul>{row.context.hiddenTools.map((item, index) => <li key={`${item.name}-${index}`}><code>{item.name}</code> · {t('hiddenToolReason')}: {item.reason}</li>)}</ul>
    </section>}
    {row.toolSelectionReasons !== undefined && row.toolSelectionReasons.length > 0 && <section className={css.requestAudit}>
      <b>{t('selectionReasons')}</b>
      <ul>{row.toolSelectionReasons.map((item, index) => <li key={`${item.name}-${index}`}><code>{item.name}</code> · {item.reason}</li>)}</ul>
    </section>}
    {row.knowledgeRetrieval !== undefined && row.knowledgeRetrieval.length > 0 && <section className={css.requestAudit}>
      <b>{t('knowledgeAudit')}</b>
      {row.knowledgeRetrieval.map((item, index) => <div key={`${item.turn}-${item.step}-${index}`}>
        <span>{item.status === 'completed' ? `${t('knowledgeHits')}: ${item.hits}` : t('knowledgeFailed')} · ~{number(item.estimatedTokens)} {t('token')}</span>
        {item.similarityThreshold !== undefined && <span> · {t('knowledgeThreshold')}: {item.similarityThreshold}</span>}
        {item.maxResultTokens !== undefined && <span> · {t('knowledgeBudget')}: {item.maxResultTokens}</span>}
        {item.skippedBases.length > 0 && <span> · {t('knowledgeSkipped')}: {item.skippedBases.join(', ')}</span>}
        {item.sources !== undefined && item.sources.length > 0 && <div className={css.knowledgeSources}>
          <span>{t('knowledgeSources')}</span>
          <ul>{item.sources.map((source, sourceIndex) => <li key={`${source.baseId}-${source.documentId}-${source.ordinal}-${sourceIndex}`}>
            {t('knowledgeSource')}: {source.baseTitle} / {source.documentTitle} · {t('similarity')} {source.score.toFixed(3)} · #{source.ordinal + 1}
          </li>)}</ul>
        </div>}
        {item.error !== undefined && <div className={css.notice}>{item.error}</div>}
      </div>)}
    </section>}
    {row.blockedTools !== undefined && row.blockedTools.length > 0 && <section className={css.requestAudit}>
      <b>{t('blockedTools')}</b>
      <ul>{row.blockedTools.map((item, index) => <li key={`${item.name}-${index}`}><code>{item.name}</code> · {item.reason}</li>)}</ul>
    </section>}
    {row.gitCheckpoints !== undefined && row.gitCheckpoints.length > 0 && <GitWorkspaceView checkpoints={row.gitCheckpoints} t={t} />}
    <div className={css.tabs} role="tablist" aria-label={t('select')}>
      {(['inputTab', 'outputTab', 'toolsTab', 'rawTab'] as const).map(key => <button key={key} type="button" role="tab"
        aria-selected={tab === key} onClick={() =>{  setTab(key) }}>{t(key)}{key === 'toolsTab' ? ` (${row.tools.length})` : ''}</button>)}
    </div>
    <div className={css.detailBody} role="tabpanel" aria-label={t(tab)}>
      {tab === 'inputTab' && <>
        <p className={css.note}>{t('sourceEstimate')}</p>
        {input.incomplete && <p className={css.notice}>{t(row.kind === 'compaction' ? 'compactionInput' : 'partialInput')}</p>}
        {input.unsupported && <p className={css.notice}>{t('customProjection')}</p>}
        {input.parts.length === 0 && <p className={css.empty}>{t('noInput')}</p>}
        {input.parts.filter(part => part.kind !== 'schema').map(part => <details key={part.id} className={css.source}>
          <summary><span>{t(part.kind)} <small>#{part.seq}</small></span><b>~{number(part.tokens)}</b></summary>
          {part.source && <div className={css.sourceMeta}>{t('source')}: {part.source}</div>}
          {part.media && <p className={css.notice}>{t('mediaEstimate')}</p>}
          <pre>{part.text}</pre>
        </details>)}
        <ToolSimilarityList parts={input.parts} tools={row.tools} t={t} />
      </>}
      {tab === 'outputTab' && <>
        <p className={css.note}>{t(row.status === 'streaming' ? 'liveEstimate' : 'sourceEstimate')}</p>
        {row.output.length === 0 && <p className={css.empty}>{t('noOutput')}</p>}
        {row.output.map((block, index) => <details key={index} className={css.source} open>
          <summary><span>{t(block.type === 'text' ? 'answer' : block.type === 'reasoning' ? 'thinking' : block.type === 'tool-call' ? 'toolCall' : 'other')}</span>
            <b>~{number(estimateText(contentText([block])))}</b></summary>
          {hasMedia([block]) && <p className={css.notice}>{t('mediaEstimate')}</p>}
          <pre>{contentText([block])}</pre>
        </details>)}
      </>}
      {tab === 'toolsTab' && <>
        <p className={css.note}>{t('toolAccounting')}</p>
        {row.tools.length === 0 && <p className={css.empty}>{t('noTools')}</p>}
        {row.tools.map(tool => <details key={tool.id} className={css.source} open>
          <summary><span>{tool.name} <small>#{tool.seq}</small></span><b>{tool.isError ? t('error') : tool.result === null ? t('waiting') : t('complete')}</b></summary>
          {tool.parentId && <p className={css.note}>{t('subtool')}</p>}
          <div className={css.sourceMeta}>{t('arguments')} · ~{number(estimateText(tool.arguments))} {t('token')}</div>
          <pre>{tool.arguments}</pre>
          <div className={css.sourceMeta}>{t('result')} · {tool.result === null ? t('waiting') : `~${number(estimateText(contentText(tool.result)))} ${t('token')}`} · {number(tool.endTime === null || tool.startTime === null ? null : tool.endTime - tool.startTime)} {t('milliseconds')}</div>
          {tool.result !== null && hasMedia(tool.result) && <p className={css.notice}>{t('mediaEstimate')}</p>}
          {tool.result !== null && <pre>{contentText(tool.result)}</pre>}
        </details>)}
      </>}
      {tab === 'rawTab' && <>
        <details className={css.source} open><summary>{t('rawUsage')}</summary><pre>{row.rawUsage === undefined ? t('unreported') : JSON.stringify(row.rawUsage, null, 2)}</pre></details>
        {window.entries.filter(entry => entry.type === 'event' && row.evidence.includes(entry.event.seq)).map(({ event }) =>
          <details key={event.seq} className={css.source}>
            <summary>{event.type} #{event.seq}</summary><pre>{JSON.stringify(event, null, 2)}</pre>
          </details>)}
      </>}
    </div>
  </aside>
}
