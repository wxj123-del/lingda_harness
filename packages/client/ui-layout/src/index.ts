/** Host loader entry for the browser-only layout plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WorkflowEngine, WorkflowResult } from '@deepseek-ai/dsh-workflow'
import { AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema } from './authoring-settings.ts'
import type { AuthoringItem, AuthoringSettings } from './authoring-settings.ts'
import { BUILTIN_SKILLS, userSkillName } from './builtin-skills.ts'
import { en } from './client/locales.ts'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { materializeSkillArchive } from './skill-archive-resources.ts'
import { runtimeToolName } from './runtime-tool-name.ts'

export { AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema }
export type { AuthoringItem, AuthoringSettings } from './authoring-settings.ts'

function runtimeSkillContent(item: AuthoringItem): string {
  const steps = item.steps.filter(step => step.trim() !== '').map((step, index) => `${index + 1}. ${step.trim()}`)
  return [item.body.trim(), steps.join('\n')].filter(Boolean).join('\n\n') || item.description.trim()
}

interface CompiledWorkflow {
  script: string
  meta: {
    name: string
    description: string
    whenToUse?: string
    phases?: { title: string }[]
  }
}

function instructionValue(item: AuthoringItem, input: unknown): { instructions: string } {
  return {
    instructions: [item.body.trim(), ...item.steps.filter(step => step.trim() !== '').map((step, index) => `${index + 1}. ${step.trim()}`), String(input ?? '').trim()]
      .filter(Boolean).join('\n'),
  }
}

function json(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function workflowPrompt(node: NonNullable<AuthoringItem['nodes']>[number]): string {
  const config = node.config ?? {}
  const instruction = node.instructions.trim() || node.title.trim() || node.kind
  switch (node.kind) {
    case 'llm': return `Execute this workflow model node.\nInstruction: ${instruction}`
    case 'tool': return `Execute this workflow tool node using the available tools.\nTool: ${config.tool?.trim() || 'unspecified'}\nInstruction: ${instruction}`
    case 'knowledge': return `Execute this workflow knowledge-base node. Use the referenced knowledge when useful.\nKnowledge: ${config.knowledge?.trim() || 'unspecified'}\nInstruction: ${instruction}`
    case 'code': return `Execute this workflow code node as a controlled transformation. Do not claim execution if it cannot be completed.\nLanguage: ${config.language?.trim() || 'unspecified'}\nInstruction: ${instruction}`
    case 'http': return `Execute this workflow HTTP node using available network tools when possible.\nMethod: ${config.method?.trim() || 'GET'}\nURL: ${config.url?.trim() || 'unspecified'}\nInstruction: ${instruction}`
    default: return `Execute this workflow node.\nInstruction: ${instruction}`
  }
}

function compileWorkflow(item: AuthoringItem): CompiledWorkflow | undefined {
  const nodes = item.nodes
  const edges = item.edges ?? []
  if (nodes === undefined || nodes.length === 0) return undefined
  const ids = new Set<string>()
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) return undefined
    ids.add(node.id)
  }
  const start = nodes.find(node => node.kind === 'start')
  if (start === undefined) return undefined
  const edgeIds = new Set<string>()
  for (const edge of edges) {
    if (!edge.id || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) return undefined
    edgeIds.add(edge.id)
  }
  const outgoing = new Map<string, typeof edges>()
  const incoming = new Map<string, typeof edges>()
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge])
  }
  const reachable = new Set<string>([start.id])
  const visitQueue = [start.id]
  for (const id of visitQueue) {
    for (const edge of outgoing.get(id) ?? []) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target)
        visitQueue.push(edge.target)
      }
    }
  }
  const indegree = new Map<string, number>([...reachable].map(id => [id, 0]))
  for (const edge of edges) {
    if (reachable.has(edge.source) && reachable.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const byId = new Map(nodes.map(node => [node.id, node]))
  const order: string[] = []
  const ready = [start.id]
  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) break
    if (order.includes(id)) continue
    order.push(id)
    for (const edge of outgoing.get(id) ?? []) {
      if (!reachable.has(edge.target)) continue
      const next = (indegree.get(edge.target) ?? 0) - 1
      indegree.set(edge.target, next)
      if (next === 0) ready.push(edge.target)
    }
  }
  if (order.length !== reachable.size) return undefined

  const phases: { title: string }[] = []
  const phaseTitles = new Set<string>()
  for (const id of order) {
    const node = byId.get(id)
    if (node === undefined || ['start', 'input', 'output', 'end', 'template'].includes(node.kind)) continue
    const title = node.title.trim() || node.kind
    if (!phaseTitles.has(title)) {
      phaseTitles.add(title)
      phases.push({ title })
    }
  }
  const lines = [
    'let value = args?.input ?? null',
    'let output = value',
    'const activeEdges = new Set()',
    'const nodeValues = Object.create(null)',
    `nodeValues[${json(start.id)}] = value`,
    ...(outgoing.get(start.id) ?? []).filter(edge => reachable.has(edge.target)).map(edge => `activeEdges.add(${json(edge.id)})`),
  ]
  for (const id of order) {
    const node = byId.get(id)
    if (node === undefined || node.id === start.id) continue
    const nodeIncoming = (incoming.get(id) ?? []).filter(edge => reachable.has(edge.source))
    const nodeOutgoing = (outgoing.get(id) ?? []).filter(edge => reachable.has(edge.target))
    const condition = nodeIncoming.map(edge => `activeEdges.has(${json(edge.id)})`).join(' || ') || 'false'
    lines.push(`if (${condition}) {`)
    lines.push(`  const nodeInputs = [${nodeIncoming.map(edge => `nodeValues[${json(edge.source)}]`).join(', ')}].filter(entry => entry !== undefined)`)
    lines.push('  const nodeInput = nodeInputs.length === 1 ? nodeInputs[0] : nodeInputs')
    switch (node.kind) {
      case 'input': {
        const variable = node.config?.variable?.trim()
        lines.push(`  value = ${variable ? `args?.variables?.[${json(variable)}] ??` : ''} args?.input ?? nodeInput ?? null`)
        break
      }
      case 'condition': {
        const options: Record<string, unknown> = {
          label: node.title.trim() || 'Condition',
          schema: { type: 'object', properties: { match: { type: 'boolean' } }, required: ['match'] },
        }
        const model = node.config?.model?.trim()
        if (model) options.model = model
        const conditionText = node.config?.condition?.trim() || node.instructions.trim() || 'Determine whether the input satisfies the condition.'
        lines.push(`  phase(${json(node.title.trim() || 'Condition')})`)
        lines.push(`  const decision = await agent(${json(`Determine whether this workflow input satisfies the condition.\nCondition: ${conditionText}`)} + ${json('\nInput: ')} + JSON.stringify(nodeInput), ${json(options)})`)
        lines.push("  const branch = decision !== null && typeof decision === 'object' && decision.match === true")
        lines.push('  value = nodeInput')
        break
      }
      case 'template': {
        const template = node.config?.template?.trim() || node.instructions.trim()
        lines.push(`  value = ${json(template)}.replace(/\\{\\{\\s*(?:value|input)\\s*\\}\\}/g, String(nodeInput ?? ''))`)
        break
      }
      case 'output':
      case 'end':
        lines.push('  value = nodeInput')
        break
      default: {
        const options: Record<string, unknown> = { label: node.title.trim() || node.kind }
        const model = node.config?.model?.trim()
        if (model) options.model = model
        const title = node.title.trim() || node.kind
        lines.push(`  phase(${json(title)})`)
        lines.push(`  value = await agent(${json(workflowPrompt(node))} + ${json('\nInput: ')} + JSON.stringify(nodeInput), ${json(options)})`)
        break
      }
    }
    lines.push(`  nodeValues[${json(node.id)}] = value`)
    lines.push('  output = value')
    if (node.kind === 'condition') {
      const trueEdge = nodeOutgoing.find(edge => edge.sourceHandle === 'true') ?? nodeOutgoing[0]
      const falseEdge = nodeOutgoing.find(edge => edge.sourceHandle === 'false') ?? nodeOutgoing.find(edge => edge !== trueEdge)
      if (trueEdge !== undefined) lines.push(`  if (branch) activeEdges.add(${json(trueEdge.id)})`)
      if (falseEdge !== undefined) lines.push(`  if (!branch) activeEdges.add(${json(falseEdge.id)})`)
    } else {
      for (const edge of nodeOutgoing) lines.push(`  activeEdges.add(${json(edge.id)})`)
    }
    lines.push('}')
  }
  lines.push('return output')
  const stableName = item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-workflow'
  const description = item.description.trim() || item.title.trim() || 'User-created workflow'
  return {
    script: lines.join('\n'),
    meta: {
      name: `ui-${stableName}`,
      description,
      ...description ? { whenToUse: description } : {},
      ...phases.length > 0 ? { phases } : {},
    },
  }
}

function renderWorkflowValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const rendered = JSON.stringify(value, null, 2)
    return rendered === undefined ? String(value) : rendered
  } catch {
    return String(value)
  }
}

async function executeWorkflow(
  item: AuthoringItem,
  input: unknown,
  exec: ToolRunContext,
  workflowEngine: WorkflowEngine | undefined,
): Promise<{ instructions: string }> {
  const compiled = compileWorkflow(item)
  if (compiled === undefined || workflowEngine === undefined || exec.agent === undefined) return instructionValue(item, input)
  const run = workflowEngine.start({
    script: compiled.script,
    meta: compiled.meta,
    args: { input },
    parent: exec.agent,
    signal: exec.signal,
  })
  const onAbort = (): void => { run.cancel('parent step aborted') }
  exec.signal.addEventListener('abort', onAbort, { once: true })
  let result: WorkflowResult | undefined
  try {
    result = await run.result
    if (result.stopReason !== 'completed') throw new Error(result.error ?? `workflow stopped with reason: ${result.stopReason}`)
    return { instructions: renderWorkflowValue(result.value) }
  } finally {
    exec.signal.removeEventListener('abort', onAbort)
    await run.dispose()
  }
}

function instructionTool(kind: 'workflow' | 'tool', item: AuthoringItem, workflowEngine: () => WorkflowEngine | undefined): ToolDefinition {
  return {
    name: runtimeToolName(kind, item),
    description: item.description || item.title,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { input: { type: 'string', description: 'Optional input for this user-created plugin.' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { instructions: { type: 'string' } }, required: ['instructions'] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      const input = (args as { input?: unknown }).input
      return kind === 'workflow' ? executeWorkflow(item, input, exec, workflowEngine()) : instructionValue(item, input)
    },
  }
}

/** Register the durable Skill/workflow/tool authoring document. */
export function apply(ctx?: Context): void {
  if (ctx === undefined) return
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings.register(AUTHORING_SETTINGS_NAMESPACE, AuthoringSettingsSchema)
    settingsCtx.inject(['skills'], (runtimeCtx) => {
      let disposers: (() => void)[] = []
      let invalidateImports = () => {}
      const temporaryHome = join(tmpdir(), `dsh-${randomUUID()}`)
      runtimeCtx.skills.registerProvider((control) => {
        invalidateImports = control.invalidate
        return {
          name: 'ui-imported-skills',
          list: async () => settings.get().skills.filter(item => item.enabled && item.archive !== undefined).map(item => ({
            name: userSkillName(item.id), description: [item.title, item.description].filter(Boolean).join(': '),
            source: 'custom' as const, provider: 'ui-imported-skills', rank: 250, locator: item.id,
            invocation: item.invocation ?? { modelInvocable: true, userInvocable: true },
          })),
          get: async (candidate, options) => {
            const item = settings.get().skills.find(item => item.id === candidate.locator && item.enabled)
            if (item?.archive === undefined) return undefined
            options.signal?.throwIfAborted()
            const documentPath = runtimeCtx.settings.documentPath
            const directory = await materializeSkillArchive(
              item.archive,
              documentPath === undefined ? temporaryHome : dirname(documentPath),
            )
            options.signal?.throwIfAborted()
            control.signal.throwIfAborted()
            return { ...candidate, content: runtimeSkillContent(item), resourceBase: { kind: 'directory', path: directory } }
          },
        }
      })
      const builtinDisposers = BUILTIN_SKILLS.map(skill => runtimeCtx.skills.register({
        name: skill.name,
        description: en[skill.description],
        source: 'bundled',
        content: [en[skill.body], ...skill.steps.map((key, index) => `${index + 1}. ${en[key]}`)].join('\n\n'),
      }))
      const syncSkills = (value: AuthoringSettings): void => {
        for (const dispose of disposers) dispose()
        disposers = value.skills.filter(item => item.enabled && item.archive === undefined).map(item => runtimeCtx.skills.register({
          name: userSkillName(item.id),
          description: [item.title, item.description].filter(Boolean).join(': '),
          content: runtimeSkillContent(item),
          source: 'custom',
          ...item.invocation === undefined ? {} : { invocation: item.invocation },
        }))
        invalidateImports()
      }
      syncSkills(settings.get())
      runtimeCtx.effect(() => {
        const stop = settings.watch((next) => { syncSkills(next) })
        return () => {
          stop()
          for (const dispose of disposers) dispose()
          for (const dispose of builtinDisposers) dispose()
          disposers = []
        }
      }, 'ui-layout: user skill runtime registrations')
    })
    settingsCtx.inject(['tools'], (runtimeCtx) => {
      let disposers: (() => void)[] = []
      const syncTools = (value: AuthoringSettings): void => {
        for (const dispose of disposers) dispose()
        const workflowEngine = (): WorkflowEngine | undefined => runtimeCtx.get('workflowEngine')
        disposers = [
          ...value.workflows.filter(item => item.enabled).map(item => runtimeCtx.tools.register(instructionTool('workflow', item, workflowEngine))),
          ...value.tools.filter(item => item.enabled).map(item => runtimeCtx.tools.register(instructionTool('tool', item, workflowEngine))),
        ]
      }
      syncTools(settings.get())
      runtimeCtx.effect(() => {
        const stop = settings.watch((next) => { syncTools(next) })
        return () => {
          stop()
          for (const dispose of disposers) dispose()
          disposers = []
        }
      }, 'ui-layout: user tool runtime registrations')
    })
  })
}
