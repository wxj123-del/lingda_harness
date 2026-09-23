/** Compile a visual workflow graph into the host workflow engine's script contract. */
import type { AuthoringItem, WorkflowNode } from './authoring-settings.ts'
import { analyzeWorkflowGraph } from './workflow-graph.ts'

export interface CompiledWorkflow {
  /** Script body accepted by the Host workflow engine. */
  script: string
  /** Node identifiers emitted by the compiler, used to scope host-side audit records. */
  nodeIds: readonly string[]
  /** Validated workflow metadata accompanying the script. */
  meta: {
    name: string
    description: string
    whenToUse?: string
    phases?: { title: string }[]
  }
}

function json(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function workflowPrompt(node: WorkflowNode): string {
  const config = node.config ?? {}
  const instruction = node.instructions.trim() || node.title.trim() || node.kind
  const credential = config.credential?.trim()
  const credentialHint = credential === undefined || credential === '' ? '' : `\nCredential reference: ${credential} (resolve it through the host credential service; never expose the secret in output)`
  switch (node.kind) {
    case 'llm': return `Execute this workflow model node.\nInstruction: ${instruction}`
    case 'tool': return `Execute this workflow tool node. Use the only available tool to perform the requested action; do not substitute another capability.\nTool: ${config.tool?.trim() || 'unspecified'}${credentialHint}\nInstruction: ${instruction}`
    case 'knowledge': return `Execute this workflow knowledge-base node. Use the referenced knowledge when useful.\nKnowledge: ${config.knowledge?.trim() || 'unspecified'}\nInstruction: ${instruction}`
    case 'code': return `Execute this workflow code node as a controlled transformation. Do not claim execution if it cannot be completed.\nLanguage: ${config.language?.trim() || 'unspecified'}\nInstruction: ${instruction}`
    case 'http': return `Execute this workflow HTTP node using available network tools when possible.\nMethod: ${config.method?.trim() || 'GET'}\nURL: ${config.url?.trim() || 'unspecified'}${credentialHint}\nInstruction: ${instruction}`
    default: return `Execute this workflow node.\nInstruction: ${instruction}`
  }
}

function retryCount(node: WorkflowNode): number {
  const value = node.config?.retries
  return typeof value === 'number' && Number.isSafeInteger(value) ? Math.max(0, Math.min(5, value)) : 0
}

function withRetry(body: string, retries: number, resultName: string, label: string): string {
  if (retries === 0) return body
  const attempts = retries + 1
  return `for (let attempt = 1; attempt <= ${attempts}; attempt++) {\n${body.split('\n').map(line => `  ${line}`).join('\n')}\n  if (${resultName} !== null || attempt === ${attempts}) break\n  log(${json(`Retrying ${label} after an unsuccessful result`)} + ' (' + attempt + '/${attempts})')\n}`
}

function withErrorRetry(body: string, retries: number, label: string): string {
  if (retries === 0) return body
  const attempts = retries + 1
  const indentedBody = body.split('\n').map(line => `    ${line}`).join('\n')
  return `for (let attempt = 1; attempt <= ${attempts}; attempt++) {
  try {
${indentedBody}
    break
  } catch (error) {
    if (error?.code === 'CANCELLED') throw error
    if (attempt === ${attempts}) throw error
    log(${json(`Retrying ${label} after an HTTP error`)} + ' (' + attempt + '/${attempts})')
  }
}`
}

function executionRetryCount(node: WorkflowNode): number {
  const retries = retryCount(node)
  if (node.kind !== 'http') return retries
  const method = node.config?.method?.trim().toUpperCase() || 'GET'
  return method === 'GET' || method === 'HEAD' ? retries : 0
}

function indent(body: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return body.split('\n').map(line => `${prefix}${line}`).join('\n')
}

/** Compile one validated editor graph into dependency waves; each wave runs independent nodes concurrently, waits for every peer to settle, then propagates the first failure without starting downstream waves. */
export function compileWorkflow(item: AuthoringItem): CompiledWorkflow | undefined {
  const nodes = item.nodes
  const edges = item.edges ?? []
  if (nodes === undefined) return undefined
  const graph = analyzeWorkflowGraph(nodes, edges)
  if (graph.issues.length > 0 || graph.startId === undefined || graph.endId === undefined) return undefined
  const start = graph.byId.get(graph.startId)
  const end = graph.byId.get(graph.endId)
  if (start === undefined || end === undefined) return undefined
  const byId = graph.byId
  const outgoing = graph.outgoing
  const incoming = graph.incoming
  const order = graph.order
  const reachable = new Set(order)

  const depths = new Map<string, number>([[start.id, 0]])
  for (const id of order) {
    const depth = depths.get(id) ?? 0
    for (const edge of outgoing.get(id) ?? []) depths.set(edge.target, Math.max(depths.get(edge.target) ?? 0, depth + 1))
  }
  const waves = new Map<number, string[]>()
  for (const id of order) {
    if (id === start.id) continue
    const depth = depths.get(id) ?? 1
    waves.set(depth, [...(waves.get(depth) ?? []), id])
  }

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
    'const initialValue = args?.input ?? null',
    'const activeEdges = new Set()',
    'const nodeValues = Object.create(null)',
    `nodeValues[${json(start.id)}] = initialValue`,
    ...(outgoing.get(start.id) ?? []).filter(edge => reachable.has(edge.target)).map(edge => `activeEdges.add(${json(edge.id)})`),
  ]
  const sortedWaves = [...waves].sort(([left], [right]) => left - right)
  let waveIndex = 0
  for (const [, ids] of sortedWaves) {
    const waveResult = `waveResults${waveIndex}`
    const waveFailure = `waveFailure${waveIndex}`
    waveIndex += 1
    lines.push(`const ${waveResult} = await Promise.allSettled([`)
    for (const id of ids) {
      const node = byId.get(id)
      if (node === undefined) continue
      const nodeIncoming = (incoming.get(id) ?? []).filter(edge => reachable.has(edge.source))
      const nodeOutgoing = (outgoing.get(id) ?? []).filter(edge => reachable.has(edge.target))
      const condition = nodeIncoming.map(edge => `activeEdges.has(${json(edge.id)})`).join(' || ') || 'false'
      lines.push('  (async () => {')
      lines.push(`    if (${condition}) {`)
      lines.push(`      log(${json(`Node started: ${node.title.trim() || node.kind}`)})`)
      lines.push(`      const nodeInputs = [${nodeIncoming.map(edge => `nodeValues[${json(edge.source)}]`).join(', ')}].filter(entry => entry !== undefined)`)
      lines.push('      const nodeInput = nodeInputs.length === 1 ? nodeInputs[0] : nodeInputs')
      lines.push('      let nodeValue = nodeInput')
      lines.push(`      nodeStart(${json(node.id)}, ${json(node.title.trim() || node.kind)}, nodeInput, ${executionRetryCount(node)})`)
      lines.push('      let branch = false')
      lines.push('      try {')
      switch (node.kind) {
        case 'input': {
          const variable = node.config?.variable?.trim()
          lines.push(`      nodeValue = ${variable ? `args?.variables?.[${json(variable)}] ??` : ''} args?.input ?? nodeInput ?? null`)
          break
        }
        case 'condition': {
          const options: Record<string, unknown> = {
            label: node.title.trim() || 'Condition',
            schema: { type: 'object', properties: { match: { type: 'boolean' } }, required: ['match'] },
          }
          const model = node.config?.model?.trim()
          if (model) options.model = model
          const conditionText = node.config?.condition?.trim() || node.instructions.trim() || ['Determine whether', ' the input satisfies the condition.'].join('')
          lines.push(`      phase(${json(node.title.trim() || 'Condition')})`)
          lines.push('      let decision')
          lines.push(indent(withRetry(`decision = await agent(${json(`Determine whether this workflow input satisfies the condition.\nCondition: ${conditionText}`)} + ${json('\nInput: ')} + JSON.stringify(nodeInput), ${json(options)})`, retryCount(node), 'decision', node.title.trim() || 'Condition'), 6))
          lines.push("      branch = decision !== null && typeof decision === 'object' && decision.match === true")
          break
        }
        case 'template': {
          const template = node.config?.template?.trim() || node.instructions.trim()
          lines.push(`      nodeValue = ${json(template)}.replace(/\\{\\{\\s*(?:value|input)\\s*\\}\\}/g, String(nodeInput ?? ''))`)
          break
        }
        case 'output':
        {
          const template = node.config?.output?.trim()
          const format = node.config?.format?.trim().toLowerCase()
          if (template !== undefined && template !== '') {
            lines.push(`      nodeValue = ${json(template)}.replace(/\\{\\{\\s*(?:value|input)\\s*\\}\\}/g, String(nodeInput ?? ''))`)
          }
          if (format === 'json') lines.push("      try { nodeValue = typeof nodeValue === 'string' ? JSON.parse(nodeValue) : nodeValue } catch { /* keep text when the requested format is not valid JSON */ }")
          break
        }
        case 'http': {
          const url = node.config?.url?.trim()
          const method = node.config?.method?.trim().toUpperCase() || 'GET'
          const credential = node.config?.credential?.trim()
          lines.push(`      phase(${json(node.title.trim() || 'HTTP request')})`)
          lines.push(indent(withErrorRetry(`nodeValue = await httpRequest({ url: ${json(url || '')}, method: ${json(method)}, ...${method === 'GET' || method === 'HEAD' ? '{}' : '{ body: nodeInput }'}${credential ? `, credential: ${json(credential)}` : ''} })`, executionRetryCount(node), node.title.trim() || 'HTTP request'), 6))
          break
        }
        case 'end':
          break
        default: {
          const options: Record<string, unknown> = { label: node.title.trim() || node.kind }
          const model = node.config?.model?.trim()
          if (model) options.model = model
          const tool = node.kind === 'tool' ? node.config?.tool?.trim() : undefined
          if (tool) options.toolFilter = { allow: [tool] }
          if (node.kind === 'knowledge') options.toolFilter = { allow: ['knowledge_search'] }
          const title = node.title.trim() || node.kind
          lines.push(`      phase(${json(title)})`)
          lines.push(indent(withRetry(`nodeValue = await agent(${json(workflowPrompt(node))} + ${json('\nInput: ')} + JSON.stringify(nodeInput), ${json(options)})`, retryCount(node), 'nodeValue', title), 6))
          break
        }
      }
      lines.push(`      nodeValues[${json(node.id)}] = nodeValue`)
      if (node.kind === 'condition') {
        const trueEdge = nodeOutgoing.find(edge => edge.sourceHandle === 'true') ?? nodeOutgoing[0]
        const falseEdge = nodeOutgoing.find(edge => edge.sourceHandle === 'false') ?? nodeOutgoing.find(edge => edge !== trueEdge)
        if (trueEdge !== undefined) lines.push(`      if (branch) activeEdges.add(${json(trueEdge.id)})`)
        if (falseEdge !== undefined) lines.push(`      if (!branch) activeEdges.add(${json(falseEdge.id)})`)
        lines.push(`      log(${json(`Condition evaluated: ${node.title.trim() || node.kind}`)} + (branch ? ' = true' : ' = false'))`)
      } else {
        for (const edge of nodeOutgoing) lines.push(`      activeEdges.add(${json(edge.id)})`)
      }
      lines.push(`      log(${json(`Node completed: ${node.title.trim() || node.kind}`)})`)
      lines.push(`      nodeEnd(${json(node.id)}, ${json(node.title.trim() || node.kind)}, 'completed', nodeValue, undefined, ${executionRetryCount(node)})`)
      lines.push('      } catch (error) {')
      lines.push(`        nodeEnd(${json(node.id)}, ${json(node.title.trim() || node.kind)}, 'failed', undefined, String(error), ${executionRetryCount(node)})`)
      lines.push('        throw error')
      lines.push('      }')
      lines.push('    }')
      lines.push('    else {')
      lines.push(`      nodeEnd(${json(node.id)}, ${json(node.title.trim() || node.kind)}, 'skipped', undefined, undefined, ${executionRetryCount(node)})`)
      lines.push('    }')
      lines.push('  })(),')
    }
    lines.push('])')
    lines.push(`const ${waveFailure} = ${waveResult}.find(result => result.status === 'rejected')`)
    lines.push(`if (${waveFailure} !== undefined) {`)
    // Downstream waves never start after a failed wave. Emit explicit terminal
    // audit records so operators can distinguish dependency blocking from a
    // condition branch that was intentionally skipped.
    for (const [, blockedIds] of sortedWaves.slice(waveIndex)) {
      for (const blockedId of blockedIds) {
        const blockedNode = byId.get(blockedId)
        if (blockedNode === undefined) continue
        lines.push(`  nodeEnd(${json(blockedNode.id)}, ${json(blockedNode.title.trim() || blockedNode.kind)}, 'blocked', undefined, undefined, ${executionRetryCount(blockedNode)})`)
      }
    }
    lines.push(`  throw ${waveFailure}.reason`)
    lines.push('}')
  }
  lines.push(`return Object.prototype.hasOwnProperty.call(nodeValues, ${json(end.id)}) ? nodeValues[${json(end.id)}] : initialValue`)
  const stableName = item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-workflow'
  const description = item.description.trim() || item.title.trim() || ['User-created', ' workflow'].join('')
  return {
    script: lines.join('\n'),
    nodeIds: nodes.map(node => node.id),
    meta: {
      name: `ui-${stableName}`,
      description,
      ...description ? { whenToUse: description } : {},
      ...phases.length > 0 ? { phases } : {},
    },
  }
}
