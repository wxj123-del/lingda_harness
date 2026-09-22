/** Mind-map view showing each model step and its expandable tool branches. */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ConvViewProps, AssistantBlock, ConversationNode, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16,
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
  readonly status?: TrajectoryKey
  readonly callId?: string
  readonly error?: boolean
  readonly children?: readonly WorkflowStep[]
}

interface WorkflowLane {
  readonly key: string
  readonly label: string
  readonly steps: readonly WorkflowStep[]
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

function toolSteps(call: WorkflowCall, t: WorkflowViewProps['t'], output: WorkflowStep[]): void {
  const result = call.result
  const children: WorkflowStep[] = []
  if (result !== undefined) {
    children.push({
      id: `result:${call.callId}`,
      kind: 'result',
      title: result.isError ? t('workflow.error') : t('workflow.result'),
      detail: result.error?.reason ?? (contentText(result.content) || t('workflow.emptyResult')),
      status: result.isError ? 'workflow.failed' : 'workflow.completed',
      callId: call.callId,
      error: result.isError,
    })
  }
  for (const child of call.children) toolSteps(child, t, children)
  output.push({
    id: `tool:${call.callId}`,
    kind: 'tool',
    title: call.name,
    detail: call.args === '' ? t('workflow.noArguments') : shorten(call.args),
    status: result === undefined ? 'workflow.running' : 'workflow.called',
    callId: call.callId,
    ...(result?.isError === true ? { error: true } : {}),
    children,
  })
}

function toolStepsForCall(call: WorkflowCall, t: WorkflowViewProps['t']): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  toolSteps(call, t, steps)
  return steps
}

function inputPreview(node: Extract<ConversationNode, { kind: 'user' | 'steering' | 'context' }>): string {
  return contentText(node.content) || ' '
}

function buildWorkflowLanes(snapshot: TrajectorySnapshot, t: WorkflowViewProps['t']): { lanes: readonly WorkflowLane[]; modelCount: number } {
  const results = collectResultCalls(snapshot.eventNodes)
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
      const response = blockText(node.blocks, 'text') || blockText(node.blocks, 'reasoning') || t('workflow.waiting')
      const modelStep: WorkflowStep = {
        id: `assistant:${node.seq}`,
        kind: 'model',
        title: t('workflow.response'),
        detail: calls.length > 0
          ? `${response} · ${t('workflow.toolsCount', { count: calls.length })}`
          : response,
        status: node.interrupted === true ? 'workflow.interrupted' : 'workflow.completed',
        children: calls.flatMap(call => toolStepsForCall(call, t)),
      }
      for (const block of node.blocks) {
        if (block.kind !== 'tool-call') continue
        shownCalls.add(block.callId)
      }
      lanes.push({
        key: `turn:${node.turn}:step:${node.step}:${node.seq}`,
        label: t('workflow.modelCall', { count: modelCount }),
        steps: [...pendingInputs, modelStep],
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

function stepIcon(kind: WorkflowKind) {
  switch (kind) {
    case 'input': return <IconUserOutline16 size={14} />
    case 'model': return <IconSparkle16 size={14} />
    case 'tool': return <IconCodeOutline16 size={14} />
    case 'result': return <IconCheckOutline16 size={14} />
  }
}

function WorkflowNode({ step, onInspect, onToggle, expanded, selectedCallId, t }: {
  readonly step: WorkflowStep
  readonly onInspect: (callId: string) => void
  readonly onToggle: (id: string) => void
  readonly expanded: boolean
  readonly selectedCallId: string | null
  readonly t: WorkflowViewProps['t']
}) {
  const clickable = step.callId !== undefined
  const expandable = !clickable && (step.children?.length ?? 0) > 0
  const showChildren = (expanded || clickable) && step.children !== undefined && step.children.length > 0
  const selected = step.callId !== undefined && step.callId === selectedCallId
  const content = <>
    <span className={css.nodeIcon} aria-hidden="true">{stepIcon(step.kind)}</span>
    <span className={css.nodeContent}>
      <span className={css.nodeTitle}>{step.title}</span>
      {step.detail !== undefined && <span className={css.nodeMeta}>{step.detail}</span>}
    </span>
    {step.status !== undefined && <span className={css.nodeStatus}>{t(step.status)}</span>}
    {expandable && <span className={css.nodeChevron} aria-hidden="true"><IconChevronDownOutline14 size={14} /></span>}
  </>
  const node = !clickable && !expandable
    ? <div className={css.node} data-kind={step.kind}>{content}</div>
    : !clickable
    ? <button
      type="button"
      className={css.node}
      data-kind={step.kind}
      data-expanded={expanded || undefined}
      aria-expanded={expandable ? expanded : undefined}
      title={expandable ? t('workflow.toggleTools') : undefined}
      onClick={() => { if (expandable) onToggle(step.id) }}
    >{content}</button>
    : <button
      type="button"
      className={css.node}
      data-kind={step.kind}
      data-error={step.error || undefined}
      data-selected={selected || undefined}
      aria-pressed={selected || undefined}
      title={t('workflow.inspect')}
      onClick={() => { onInspect(step.callId as string) }}
    >{content}</button>
  return <div
    className={css.nodeGroup}
    data-kind={step.kind}
    data-has-children={expandable || undefined}
    data-expanded={expandable && expanded || undefined}
  >
    {node}
    {showChildren && (
      <div className={css.childNodes}>
        {step.children.map(child => (
          <WorkflowNode
            key={child.id}
            step={child}
            selectedCallId={selectedCallId}
            onInspect={onInspect}
            onToggle={onToggle}
            expanded={false}
            t={t}
          />
        ))}
      </div>
    )}
  </div>
}

function serialized(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value, null, 2)
    return text === undefined ? fallback : text
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
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    if (selectedCallId !== null && !calls.has(selectedCallId)) setSelectedCallId(null)
  }, [calls, selectedCallId])
  const selectedCall = selectedCallId === null ? undefined : calls.get(selectedCallId)
  const toolCount = lanes.reduce((count, lane) => count + countTools(lane.steps), 0)
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
        <div className={css.legend} aria-hidden="true">
          <span className={css.legendItem}><span className={css.legendDot} style={{ '--workflow-accent': '#8a6fd1' } as CSSProperties} />{t('workflow.model')}</span>
          <span className={css.legendItem}><span className={css.legendDot} style={{ '--workflow-accent': '#c27a32' } as CSSProperties} />{t('workflow.tool')}</span>
          <span className={css.legendItem}><span className={css.legendDot} style={{ '--workflow-accent': '#4b9a72' } as CSSProperties} />{t('workflow.result')}</span>
        </div>
      </header>
      <div
        className={css.workspace}
        data-inspector-open={selectedCall === undefined ? undefined : true}
        data-canvas-collapsed={canvasCollapsed || undefined}
      >
        <div className={css.canvas} data-collapsed={canvasCollapsed || undefined}>
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
              : lanes.map(lane => (
                <div className={css.lane} key={lane.key}>
                  <div className={css.laneLabel}>{lane.label}</div>
                  <div className={css.laneBody}>
                    {lane.steps.map((step, index) => (
                      <div className={css.step} key={step.id}>
                        {index > 0 && <span className={css.connector} aria-hidden="true" />}
                        <WorkflowNode
                          step={step}
                          selectedCallId={selectedCallId}
                          onInspect={(callId) => { setSelectedCallId(callId) }}
                          onToggle={(id) => {
                            setExpandedIds(current => {
                              const next = new Set(current)
                              if (next.has(id)) next.delete(id)
                              else next.add(id)
                              return next
                            })
                          }}
                          expanded={expandedIds.has(step.id)}
                          t={t}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
