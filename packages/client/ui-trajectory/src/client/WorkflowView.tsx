/** Mind-map view laying each model call out as one horizontal card row. */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { ConvViewProps, AssistantBlock, AssistantMessageNode, ConversationNode, RequestView, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconCheckOutline16, IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16,
  IconCodeOutline16, IconSparkle16, IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrajectoryKey } from './locales.ts'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import css from './WorkflowView.module.css'

type WorkflowKind = 'input' | 'model' | 'tool' | 'result'

interface WorkflowCall {
  readonly callId: string
  readonly name: string
  readonly args: string
  readonly result?: ToolResultNode
  readonly children: readonly WorkflowCall[]
}

interface WorkflowStep {
  readonly id: string
  readonly kind: WorkflowKind
  readonly title: string
  readonly detail?: string
  /** Locale key rendered as the status badge on model steps. */
  readonly status?: TrajectoryKey
  /** Already rendered outcome line shown under a tool card. */
  readonly outcome?: string
  readonly callId?: string
  readonly error?: boolean
  readonly children?: readonly WorkflowStep[]
}

interface LaneStats {
  /** Wall-clock start of the model call, when recorded. */
  readonly startTime?: number
  readonly duration?: string
  /** Total prompt tokens: uncached input plus cache reads and writes. */
  readonly inputTokens?: number
  /** Prompt tokens served outside the cache. */
  readonly uncachedTokens?: number
  readonly cacheReadTokens?: number
  readonly outputTokens?: number
}

interface WorkflowLane {
  readonly key: string
  readonly label: string
  readonly steps: readonly WorkflowStep[]
  readonly modelIndex?: number
  readonly modelName?: string
  readonly stats?: LaneStats
}

interface WorkflowData {
  readonly lanes: readonly WorkflowLane[]
  readonly calls: ReadonlyMap<string, WorkflowCall>
  readonly modelCount: number
}

export type WorkflowViewProps = ConvViewProps & PropsLocale<'trajectory'>

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function shorten(value: string, limit = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`
}

function contentText(content: readonly unknown[]): string {
  const chunks: string[] = []
  for (const block of content) {
    const item = record(block)
    if (item === null) continue
    const text = typeof item.text === 'string'
      ? item.text
      : typeof item.content === 'string' ? item.content : undefined
    if (text !== undefined && text.trim() !== '') chunks.push(text)
  }
  return shorten(chunks.join(' '))
}

function blockText(blocks: readonly AssistantBlock[], kind: 'text' | 'reasoning'): string {
  return shorten(blocks
    .filter((block): block is Extract<AssistantBlock, { kind: 'text' | 'reasoning' }> => block.kind === kind)
    .map(block => block.text)
    .join(' '))
}

function callFromResult(result: ToolResultNode, calls: ReadonlyMap<string, ToolResultNode>): WorkflowCall {
  const call = result.call
  return {
    callId: result.callId,
    name: call?.name ?? result.callId,
    args: call?.argsRaw ?? '',
    result,
    children: result.subCalls.map(child => callFromBlock(child, calls)),
  }
}

type CallInput = Extract<AssistantBlock, { kind: 'tool-call' }> | ToolCallBlock

function callFromBlock(block: CallInput, calls: ReadonlyMap<string, ToolResultNode>): WorkflowCall {
  if ('kind' in block && block.kind === 'tool-result') return callFromResult(block, calls)
  const result = calls.get(block.callId)
  return {
    callId: block.callId,
    name: block.name,
    args: block.argsRaw,
    ...(result === undefined ? {} : { result }),
    children: result === undefined
      ? ('subCalls' in block ? block.subCalls.map(child => callFromBlock(child, calls)) : [])
      : result.subCalls.map(child => callFromBlock(child, calls)),
  }
}

function collectResultCalls(nodes: readonly ConversationNode[]): ReadonlyMap<string, ToolResultNode> {
  const results = new Map<string, ToolResultNode>()
  for (const node of nodes) {
    if (node.kind === 'tool-result') results.set(node.callId, node)
  }
  return results
}

function collectCalls(snapshot: TrajectorySnapshot): ReadonlyMap<string, WorkflowCall> {
  const results = collectResultCalls(snapshot.eventNodes)
  const calls = new Map<string, WorkflowCall>()
  const register = (call: WorkflowCall): void => {
    calls.set(call.callId, call)
    for (const child of call.children) register(child)
  }
  for (const node of snapshot.eventNodes) {
    if (node.kind === 'assistant') {
      for (const block of node.blocks) {
        if (block.kind === 'tool-call') register(callFromBlock(block, results))
      }
    } else if (node.kind === 'tool-result') {
      register(callFromResult(node, results))
    }
  }
  for (const call of snapshot.runningCalls) register(callFromBlock(call, results))
  return calls
}

function toolOutcome(call: WorkflowCall, t: WorkflowViewProps['t']): string {
  const result = call.result
  if (result === undefined) return t('workflow.running')
  const text = result.error?.reason ?? contentText(result.content)
  const summary = text === '' ? t('workflow.emptyResult') : text
  const start = result.callTime
  const duration = start !== null && result.time >= start ? formatMilliseconds(result.time - start) : undefined
  return duration === undefined ? summary : `${summary} · ${duration}`
}

function toolSteps(call: WorkflowCall, t: WorkflowViewProps['t'], output: WorkflowStep[]): void {
  const result = call.result
  const children: WorkflowStep[] = []
  for (const child of call.children) toolSteps(child, t, children)
  output.push({
    id: `tool:${call.callId}`,
    kind: 'tool',
    title: call.name,
    detail: call.args === '' ? t('workflow.noArguments') : shorten(call.args),
    outcome: toolOutcome(call, t),
    callId: call.callId,
    ...(result?.isError === true ? { error: true } : {}),
    ...(children.length === 0 ? {} : { children }),
  })
}

function toolStepsForCall(call: WorkflowCall, t: WorkflowViewProps['t']): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  toolSteps(call, t, steps)
  return steps
}

function formatMilliseconds(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`
  const seconds = milliseconds / 1_000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${Math.round(seconds % 60)}s`
}

function inputPreview(node: Extract<ConversationNode, { kind: 'user' | 'steering' | 'context' }>): string {
  return contentText(node.content) || ' '
}

function tokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function readTokenUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const usage = value as Partial<TokenUsage>
  return typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number' ? usage as TokenUsage : undefined
}

function laneStats(node: AssistantMessageNode, request: Extract<RequestView, { purpose: 'assistant' }> | undefined): LaneStats | undefined {
  const usage = readTokenUsage(request?.usage ?? node.usage)
  const input = tokenCount(usage?.inputTokens)
  const cacheRead = tokenCount(usage?.cacheReadTokens)
  const cacheWrite = tokenCount(usage?.cacheWriteTokens)
  const prompt = input === undefined && cacheRead === undefined && cacheWrite === undefined
    ? undefined
    : (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
  const start = node.timing?.stepStartTime ?? undefined
  const end = node.timing?.completedTime ?? node.time
  const duration = start !== undefined && end >= start ? formatMilliseconds(end - start) : undefined
  const output = tokenCount(usage?.outputTokens)
  if (start === undefined && duration === undefined && prompt === undefined && output === undefined) return undefined
  return {
    ...(start === undefined ? {} : { startTime: start }),
    ...(duration === undefined ? {} : { duration }),
    ...(prompt === undefined ? {} : { inputTokens: prompt }),
    ...(input === undefined ? {} : { uncachedTokens: input }),
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(output === undefined ? {} : { outputTokens: output }),
  }
}

function requestComposition(node: AssistantMessageNode, request: Extract<RequestView, { purpose: 'assistant' }> | undefined, t: WorkflowViewProps['t']): string {
  const prompt = request?.prompt
  const parts = [
    t('workflow.systemCount', { count: prompt !== undefined && prompt.system.trim() !== '' ? 1 : 0 }),
    t('workflow.messageCount', { count: node.blocks.filter(block => block.kind === 'text').length }),
    t('workflow.toolDefinitionCount', { count: prompt?.tools.length ?? 0 }),
  ]
  return parts.join(' · ')
}

function responseComposition(node: AssistantMessageNode, toolCount: number, t: WorkflowViewProps['t']): string {
  return [
    t('workflow.reasoningCount', { count: node.blocks.filter(block => block.kind === 'reasoning').length }),
    t('workflow.contentCount', { count: node.blocks.filter(block => block.kind === 'text').length }),
    t('workflow.toolCallCount', { count: toolCount }),
  ].join(' · ')
}

/** Format one epoch millisecond timestamp as a local HH:MM:SS clock time. */
function clockTime(time: number | undefined): string | undefined {
  if (time === undefined) return undefined
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function buildWorkflowLanes(snapshot: TrajectorySnapshot, t: WorkflowViewProps['t']): { lanes: readonly WorkflowLane[]; modelCount: number } {
  const results = collectResultCalls(snapshot.eventNodes)
  const requests = new Map(snapshot.requests
    .filter((request): request is Extract<RequestView, { purpose: 'assistant' }> => request.purpose === 'assistant' && request.resultSeq !== undefined)
    .map(request => [request.resultSeq as number, request]))
  const shownCalls = new Set<string>()
  const lanes: WorkflowLane[] = []
  let pendingInputs: WorkflowStep[] = []
  let modelCount = 0
  const flushInputs = (): void => {
    if (pendingInputs.length === 0) return
    lanes.push({ key: `input:${pendingInputs[0]?.id ?? lanes.length}`, label: t('workflow.input'), steps: pendingInputs })
    pendingInputs = []
  }
  for (const node of snapshot.eventNodes) {
    if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context') {
      pendingInputs.push({
        id: `input:${node.seq}`,
        kind: 'input',
        title: node.kind === 'context' ? t('workflow.context') : t('workflow.request'),
        detail: inputPreview(node),
      })
      continue
    }
    if (node.kind === 'assistant') {
      const calls = node.blocks
        .filter((block): block is Extract<AssistantBlock, { kind: 'tool-call' }> => block.kind === 'tool-call')
        .map(block => callFromBlock(block, results))
      modelCount += 1
      const request = requests.get(node.seq)
      const modelName = node.providerMetadata?.model ?? node.requestConfig?.model ?? request?.requestConfig?.model
      const response = blockText(node.blocks, 'text') || blockText(node.blocks, 'reasoning') || t('workflow.waiting')
      const requestStep: WorkflowStep = {
        id: `request:${node.seq}`,
        kind: 'input',
        title: t('workflow.request'),
        detail: [modelName, requestComposition(node, request, t)].filter(Boolean).join('\n'),
      }
      const responseStep: WorkflowStep = {
        id: `assistant:${node.seq}`,
        kind: 'model',
        title: t('workflow.response'),
        detail: `${response}\n${responseComposition(node, calls.length, t)}`,
        status: node.interrupted === true ? 'workflow.interrupted' : 'workflow.completed',
      }
      for (const block of node.blocks) {
        if (block.kind !== 'tool-call') continue
        shownCalls.add(block.callId)
      }
      const stats = laneStats(node, request)
      lanes.push({
        key: `turn:${node.turn}:step:${node.step}:${node.seq}`,
        label: t('workflow.modelCall', { count: modelCount }),
        steps: [requestStep, responseStep, ...calls.flatMap(call => toolStepsForCall(call, t))],
        modelIndex: modelCount,
        ...(modelName === undefined ? {} : { modelName }),
        ...(stats === undefined ? {} : { stats }),
      })
      pendingInputs = []
      continue
    }
    if (node.kind === 'tool-result' && !shownCalls.has(node.callId)) {
      flushInputs()
      shownCalls.add(node.callId)
      const steps = toolStepsForCall(callFromResult(node, results), t)
      lanes.push({ key: `tool:${node.seq}`, label: t('workflow.tool'), steps })
    }
  }
  flushInputs()
  const pendingCalls = snapshot.runningCalls.filter(call => !shownCalls.has(call.callId))
  if (pendingCalls.length > 0) {
    const steps = pendingCalls.flatMap(call => toolStepsForCall(callFromBlock(call, results), t))
    lanes.push({ key: 'running', label: t('workflow.tool'), steps })
  }
  return { lanes, modelCount }
}

function buildWorkflowData(snapshot: TrajectorySnapshot, t: WorkflowViewProps['t']): WorkflowData {
  const workflow = buildWorkflowLanes(snapshot, t)
  return { ...workflow, calls: collectCalls(snapshot) }
}

function countTools(steps: readonly WorkflowStep[]): number {
  return steps.reduce((count, step) => count + (step.kind === 'tool' ? 1 : 0) + countTools(step.children ?? []), 0)
}

function formatDuration(snapshot: TrajectorySnapshot): string {
  const times = snapshot.eventNodes
    .map(node => node.time)
    .filter((time): time is number => typeof time === 'number' && Number.isFinite(time))
  if (times.length < 2) return '—'
  return formatMilliseconds(Math.max(0, Math.max(...times) - Math.min(...times)))
}

function stepIcon(kind: WorkflowKind) {
  switch (kind) {
    case 'input': return <IconUserOutline16 size={14} />
    case 'model': return <IconSparkle16 size={14} />
    case 'tool': return <IconCodeOutline16 size={14} />
    case 'result': return <IconCheckOutline16 size={14} />
  }
}

function stepTag(kind: WorkflowKind, t: WorkflowViewProps['t']): string {
  switch (kind) {
    case 'input': return t('workflow.requestTag')
    case 'model': return t('workflow.responseTag')
    case 'tool': return t('workflow.toolTag')
    case 'result': return t('workflow.resultTag')
  }
}

function WorkflowNode({ step, onInspect, selectedCallId, t }: {
  readonly step: WorkflowStep
  readonly onInspect: (callId: string) => void
  readonly selectedCallId: string | null
  readonly t: WorkflowViewProps['t']
}) {
  const clickable = step.callId !== undefined
  const selected = step.callId !== undefined && step.callId === selectedCallId
  const content = <>
    <span className={css.nodeIcon} aria-hidden="true">{stepIcon(step.kind)}</span>
    <span className={css.nodeContent}>
      <span className={css.nodeTitle}><span className={css.nodeTag}>{stepTag(step.kind, t)}</span>{step.title}</span>
      {step.detail !== undefined && <span className={css.nodeMeta}>{step.detail}</span>}
    </span>
    {step.status !== undefined && <span className={css.nodeStatus}>{t(step.status)}</span>}
  </>
  const node = !clickable
    ? <div className={css.node} data-kind={step.kind}>{content}</div>
    : <button
      type="button"
      className={css.node}
      data-kind={step.kind}
      data-error={step.error || undefined}
      data-selected={selected || undefined}
      aria-pressed={selected || undefined}
      aria-label={step.kind === 'tool' ? step.title : undefined}
      title={t('workflow.inspect')}
      onClick={() => { onInspect(step.callId as string) }}
    >{content}</button>
  return <div className={css.nodeGroup} data-kind={step.kind}>
    {node}
    {step.outcome !== undefined && (
      <span className={css.nodeOutcome} data-error={step.error || undefined}>
        <IconCheckOutline16 size={12} />
        <span>{step.outcome}</span>
      </span>
    )}
    {step.children !== undefined && step.children.length > 0 && (
      <div className={css.childNodes}>
        {step.children.map(child => (
          <WorkflowNode key={child.id} step={child} selectedCallId={selectedCallId} onInspect={onInspect} t={t} />
        ))}
      </div>
    )}
  </div>
}

function serialized(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value, null, 2)
    return typeof text === 'string' ? text : fallback
  } catch {
    return fallback
  }
}

function resultText(result: ToolResultNode | undefined, t: WorkflowViewProps['t']): string {
  if (result === undefined) return t('workflow.noResult')
  if (result.error?.reason !== undefined) return result.error.reason
  const content = result.content
    .map((block) => {
      const item = record(block)
      if (item === null) return ''
      if (typeof item.text === 'string') return item.text
      if (typeof item.content === 'string') return item.content
      return serialized(block, '')
    })
    .filter(Boolean)
    .join('\n')
  return content || t('workflow.emptyResult')
}

function callStatus(call: WorkflowCall, t: WorkflowViewProps['t']): { label: string; error: boolean } {
  if (call.result === undefined) return { label: t('workflow.running'), error: false }
  return call.result.isError
    ? { label: t('workflow.failed'), error: true }
    : { label: t('workflow.completed'), error: false }
}

function WorkflowInspector({ call, onClose, onInspect, t }: {
  readonly call: WorkflowCall
  readonly onClose: () => void
  readonly onInspect: (callId: string) => void
  readonly t: WorkflowViewProps['t']
}) {
  const status = callStatus(call, t)
  return (
    <aside className={css.inspector} aria-label={t('workflow.inspector')}>
      <header className={css.inspectorHeader}>
        <div className={css.inspectorHeading}>
          <span className={css.inspectorKicker}>{t('workflow.toolCall')}</span>
          <h2 className={css.inspectorTitle}>{call.name}</h2>
        </div>
        <button
          type="button"
          className={css.inspectorClose}
          aria-label={t('workflow.closeInspector')}
          title={t('workflow.closeInspector')}
          onClick={onClose}
        >
          <IconCloseOutline16 size={16} />
        </button>
      </header>
      <div className={css.inspectorBody}>
        <div className={css.inspectorStatus} data-error={status.error || undefined}>
          <span className={css.statusDot} aria-hidden="true" />
          <span>{status.label}</span>
          <code>{call.callId}</code>
        </div>
        <section className={css.inspectorSection}>
          <h3>{t('workflow.arguments')}</h3>
          <pre className={css.inspectorCode}>{call.args === '' ? t('workflow.noArguments') : call.args}</pre>
        </section>
        <section className={css.inspectorSection}>
          <h3>{t('workflow.resultPayload')}</h3>
          <pre className={css.inspectorCode}>{resultText(call.result, t)}</pre>
        </section>
        {call.children.length > 0 && (
          <section className={css.inspectorSection}>
            <h3>{t('workflow.children')}</h3>
            <div className={css.childList}>
              {call.children.map((child) => {
                const childStatus = callStatus(child, t)
                return (
                  <button
                    type="button"
                    className={css.childRow}
                    key={child.callId}
                    onClick={() => { onInspect(child.callId) }}
                  >
                    <span className={css.childName}>{child.name}</span>
                    <span className={css.childStatus} data-error={childStatus.error || undefined}>{childStatus.label}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </aside>
  )
}

/** Render an expandable, clickable map of model and tool activity for the active Session. */
export function WorkflowView({ useTrajectory, t }: WorkflowViewProps) {
  const snapshot = useTrajectory(value => value)
  const data = useMemo(() => buildWorkflowData(snapshot, t), [snapshot, t])
  const { lanes, calls, modelCount } = data
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const [canvasCollapsed, setCanvasCollapsed] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  useEffect(() => {
    if (selectedCallId !== null && !calls.has(selectedCallId)) setSelectedCallId(null)
  }, [calls, selectedCallId])
  const selectedCall = selectedCallId === null ? undefined : calls.get(selectedCallId)
  const toolCount = lanes.reduce((count, lane) => count + countTools(lane.steps), 0)
  const userMessageCount = snapshot.eventNodes.filter(node => node.kind === 'user').length
  const modelLanes = lanes.filter(lane => lane.modelIndex !== undefined)
  const firstInput = snapshot.eventNodes.find(node => node.kind === 'user' || node.kind === 'steering' || node.kind === 'context')
  const conversationPreview = firstInput === undefined
    ? t('workflow.userConversation')
    : shorten(inputPreview(firstInput).trim(), 58) || t('workflow.userConversation')
  const workflowRunning = snapshot.partial !== null || snapshot.runningCalls.length > 0
  const jumpToLane = (key: string): void => {
    const target = document.querySelector<HTMLElement>(`[data-workflow-lane="${CSS.escape(key)}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <section className={css.root} aria-label={t('workflow.aria')}>
      <header className={css.header}>
        <div className={css.heading}>
          <button
            type="button"
            className={css.collapseButton}
            aria-expanded={!canvasCollapsed}
            aria-label={canvasCollapsed ? t('workflow.expand') : t('workflow.collapse')}
            title={canvasCollapsed ? t('workflow.expand') : t('workflow.collapse')}
            onClick={() => { setCanvasCollapsed(value => !value) }}
          >
            {canvasCollapsed ? <IconChevronRightOutline14 size={16} /> : <IconChevronLeftOutline14 size={16} />}
          </button>
          <h1 className={css.title}>{t('view.workflow')}</h1>
          <span className={css.summary}>{t('workflow.summary', { models: modelCount, tools: toolCount })}</span>
        </div>
        <div className={css.headerRight}>
          <div className={css.stats} aria-label={t('workflow.stats')}>
            <div className={css.stat}><strong>{userMessageCount}</strong><span>{t('workflow.userMessages')}</span></div>
            <div className={css.stat}><strong>{modelCount}</strong><span>{t('workflow.modelCalls')}</span></div>
            <div className={css.stat}><strong>{toolCount}</strong><span>{t('workflow.toolCalls')}</span></div>
            <div className={css.stat}><strong>{formatDuration(snapshot)}</strong><span>{t('workflow.totalDuration')}</span></div>
          </div>
          <div className={css.legend} aria-hidden="true">
            <span className={css.legendItem}><span className={css.legendDot} style={{ '--workflow-accent': '#8a6fd1' } as CSSProperties} />{t('workflow.model')}</span>
            <span className={css.legendItem}><span className={css.legendDot} style={{ '--workflow-accent': '#c27a32' } as CSSProperties} />{t('workflow.tool')}</span>
            <span className={css.legendItem}><span className={css.legendDot} style={{ '--workflow-accent': '#4b9a72' } as CSSProperties} />{t('workflow.result')}</span>
          </div>
        </div>
      </header>
      <div
        className={css.workspace}
        data-inspector-open={selectedCall === undefined ? undefined : true}
        data-canvas-collapsed={canvasCollapsed || undefined}
      >
        <div className={css.canvas} data-workflow-canvas="true" data-collapsed={canvasCollapsed || undefined}>
          {canvasCollapsed
            ? <button
              type="button"
              className={css.expandRail}
              aria-label={t('view.workflow')}
              title={t('workflow.expand')}
              onClick={() => { setCanvasCollapsed(false) }}
            >
              <IconChevronRightOutline14 size={16} />
              <span>{t('view.workflow')}</span>
            </button>
            : lanes.length === 0
              ? <p className={css.empty}>{t('workflow.empty')}</p>
              : <div className={css.canvasInner} data-rail-collapsed={railCollapsed || undefined}>
                <nav className={css.callRail} data-collapsed={railCollapsed || undefined} aria-label={t('workflow.callList')}>
                  <div className={css.callRailHeader}>
                    {!railCollapsed && <><span>{t('workflow.userConversation')}</span><strong>{userMessageCount}</strong></>}
                    <button
                      type="button"
                      className={css.railToggle}
                      aria-expanded={!railCollapsed}
                      aria-label={railCollapsed ? t('workflow.expandSidebar') : t('workflow.collapseSidebar')}
                      title={railCollapsed ? t('workflow.expandSidebar') : t('workflow.collapseSidebar')}
                      onClick={() => { setRailCollapsed(value => !value) }}
                    >
                      {railCollapsed ? <IconChevronRightOutline14 size={14} /> : <IconChevronLeftOutline14 size={14} />}
                    </button>
                  </div>
                  {!railCollapsed && <div className={css.callRailContent}>
                    <button type="button" className={css.conversationItem} onClick={() => { document.querySelector<HTMLElement>('[data-workflow-canvas="true"]')?.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                      <span className={css.conversationTitle}>{conversationPreview}</span>
                      <span className={css.conversationMeta}>{t('workflow.conversationSummary', { models: modelCount, tools: toolCount })}</span>
                      <span className={css.callRailStatus} data-running={workflowRunning || undefined}><span className={css.callRailDot} />{workflowRunning ? t('workflow.running') : t('workflow.completed')}</span>
                    </button>
                    <div className={css.callRailSection}>{t('workflow.modelCalls')}</div>
                    <div className={css.callRailList}>
                      {modelLanes.map(lane => (
                        <button
                          type="button"
                          className={css.callRailItem}
                          key={lane.key}
                          onClick={() => { jumpToLane(lane.key) }}
                        >
                          <span className={css.callRailTitle}>{lane.label}</span>
                          <span className={css.callRailMeta}>{t('workflow.toolsCount', { count: countTools(lane.steps) })}</span>
                          <span className={css.callRailStatus}><span className={css.callRailDot} />{t('workflow.completed')}</span>
                        </button>
                      ))}
                    </div>
                  </div>}
                </nav>
                <div className={css.flowList}>
                  {lanes.map(lane => (
                    <div className={css.lane} key={lane.key} data-workflow-lane={lane.key}>
                      <div className={css.laneLabel}>
                        <span>{lane.label}</span>
                        {lane.modelIndex !== undefined && <span className={css.laneMeta}>
                          {lane.stats?.startTime !== undefined && <span>{clockTime(lane.stats.startTime)}</span>}
                          {lane.stats?.duration !== undefined && <span>{lane.stats.duration}</span>}
                          {lane.stats?.inputTokens !== undefined && <span>{t('workflow.inputTokens', { count: lane.stats.inputTokens })}</span>}
                          {lane.stats?.uncachedTokens !== undefined && <span>{t('workflow.uncachedTokens', { count: lane.stats.uncachedTokens })}</span>}
                          {lane.stats?.cacheReadTokens !== undefined && <span>{t('workflow.cacheReadTokens', { count: lane.stats.cacheReadTokens })}</span>}
                          {lane.stats?.outputTokens !== undefined && <span>{t('workflow.outputTokens', { count: lane.stats.outputTokens })}</span>}
                          <span className={css.laneStatus}><span className={css.callRailDot} />{workflowRunning ? t('workflow.running') : t('workflow.completed')}</span>
                        </span>}
                      </div>
                      <div className={css.laneBody}>
                        {lane.steps.map((step, index) => (
                          <div className={css.step} key={step.id}>
                            {index > 0 && <span className={css.connector} aria-hidden="true" />}
                            <WorkflowNode
                              step={step}
                              selectedCallId={selectedCallId}
                              onInspect={(callId) => { setSelectedCallId(callId) }}
                              t={t}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>}
        </div>
        {selectedCall !== undefined && (
          <WorkflowInspector
            key={selectedCall.callId}
            call={selectedCall}
            onClose={() => { setSelectedCallId(null) }}
            onInspect={setSelectedCallId}
            t={t}
          />
        )}
      </div>
    </section>
  )
}
