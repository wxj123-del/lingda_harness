import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../src/workflow-compile.ts'
import type { AuthoringItem } from '../src/authoring-settings.ts'

function item(nodes: NonNullable<AuthoringItem['nodes']>, edges: NonNullable<AuthoringItem['edges']>): AuthoringItem {
  return { id: 'workflow-compile-test', title: 'Compile test', description: 'test', enabled: true, body: '', steps: [], nodes, edges, updatedAt: 0 }
}

const node = (id: string, kind: NonNullable<AuthoringItem['nodes']>[number]['kind'], retries = 0) => ({ id, kind, title: id, instructions: kind === 'llm' ? 'Process input' : '', config: retries === 0 ? {} : { retries }, x: 0, y: 0 })

describe('visual workflow compiler', () => {
  it('emits a bounded retry loop for model nodes', () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'), node('model', 'llm', 2), node('end', 'end'),
    ], [
      { id: 'start-model', source: 'start', target: 'model' },
      { id: 'model-end', source: 'model', target: 'end' },
    ]))
    expect(compiled?.script).toContain('attempt <= 3')
    expect(compiled?.script).toContain('Retrying model after an unsuccessful result')
    expect(compiled?.script).toContain('Node started: model')
    expect(compiled?.script).toContain('Node completed: model')
  })

  it('preserves true and false condition branches in the generated script', () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'), node('check', 'condition'), node('yes', 'output'), node('no', 'output'), node('end', 'end'),
    ], [
      { id: 'start-check', source: 'start', target: 'check' },
      { id: 'check-yes', source: 'check', target: 'yes', sourceHandle: 'true' },
      { id: 'check-no', source: 'check', target: 'no', sourceHandle: 'false' },
      { id: 'yes-end', source: 'yes', target: 'end' },
      { id: 'no-end', source: 'no', target: 'end' },
    ]))
    expect(compiled?.script).toContain('activeEdges.add("check-yes")')
    expect(compiled?.script).toContain('activeEdges.add("check-no")')
    expect(compiled?.script).toContain('Condition evaluated: check')
  })

  it('starts a join when any active predecessor reaches it', async () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'), node('check', 'condition'), node('yes', 'output'), node('no', 'output'), node('join', 'output'), node('end', 'end'),
    ], [
      { id: 'start-check', source: 'start', target: 'check' },
      { id: 'check-yes', source: 'check', target: 'yes', sourceHandle: 'true' },
      { id: 'check-no', source: 'check', target: 'no', sourceHandle: 'false' },
      { id: 'yes-join', source: 'yes', target: 'join' },
      { id: 'no-join', source: 'no', target: 'join' },
      { id: 'join-end', source: 'join', target: 'end' },
    ]))
    expect(compiled).toBeDefined()
    const events: string[] = []
    const execute = new Function('args', 'agent', 'nodeStart', 'nodeEnd', 'log', 'phase', `return (async () => {\n${compiled!.script}\n})()`)
    await expect(execute({ input: 'seed' }, async () => ({ match: true }), (id: string) => { events.push(`start:${id}`) }, (id: string, _label: string, status: string) => { events.push(`${status}:${id}`) }, () => {}, () => {})).resolves.toBe('seed')
    expect(events).toEqual(expect.arrayContaining(['completed:yes', 'skipped:no', 'completed:join', 'completed:end']))
  })

  it('isolates tool nodes to their configured host tool', () => {
    const tool = { ...node('tool', 'tool'), instructions: 'Read the requested file', config: { tool: 'read' } }
    const compiled = compileWorkflow(item([
      node('start', 'start'), tool, node('end', 'end'),
    ], [
      { id: 'start-tool', source: 'start', target: 'tool' },
      { id: 'tool-end', source: 'tool', target: 'end' },
    ]))
    expect(compiled?.script).toContain('"toolFilter":{"allow":["read"]}')
    expect(compiled?.script).toContain('Use the only available tool')

    expect(compileWorkflow(item([
      node('start', 'start'), node('missing', 'tool'), node('end', 'end'),
    ], [
      { id: 'start-missing', source: 'start', target: 'missing' },
      { id: 'missing-end', source: 'missing', target: 'end' },
    ]))).toBeUndefined()
  })

  it('executes independent branches in parallel waves and waits at joins', () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'),
      { ...node('left', 'template'), config: { template: 'left' } },
      { ...node('right', 'template'), config: { template: 'right' } },
      node('join', 'output'),
      node('end', 'end'),
    ], [
      { id: 'start-left', source: 'start', target: 'left' },
      { id: 'start-right', source: 'start', target: 'right' },
      { id: 'left-join', source: 'left', target: 'join' },
      { id: 'right-join', source: 'right', target: 'join' },
      { id: 'join-end', source: 'join', target: 'end' },
    ]))
    expect(compiled?.script.match(/await Promise\.allSettled\(\[/g)).toHaveLength(3)
    expect(compiled?.script.indexOf('nodeValues["left"]')).toBeLessThan(compiled?.script.indexOf('nodeValues["join"]') ?? -1)
    expect(compiled?.script).toContain('nodeValues["left"], nodeValues["right"]')
  })

  it('waits for every peer in a failed wave before propagating the first failure', async () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'),
      { ...node('fast-fail', 'http'), config: { url: 'https://example.com/fail' } },
      { ...node('slow-peer', 'http'), config: { url: 'https://example.com/slow' } },
      node('end', 'end'),
    ], [
      { id: 'start-fast', source: 'start', target: 'fast-fail' },
      { id: 'start-slow', source: 'start', target: 'slow-peer' },
      { id: 'fast-end', source: 'fast-fail', target: 'end' },
      { id: 'slow-end', source: 'slow-peer', target: 'end' },
    ]))
    expect(compiled).toBeDefined()
    const events: string[] = []
    const execute = new Function('args', 'nodeStart', 'nodeEnd', 'log', 'phase', 'httpRequest', `return (async () => {\n${compiled!.script}\n})()`)
    await expect(execute({}, (id: string) => { events.push(`start:${id}`) }, (id: string, _label: string, status: string) => { events.push(`${status}:${id}`) }, () => {}, () => {}, async ({ url }: { url: string }) => {
      if (url.endsWith('/fail')) throw new Error('request failed')
      await new Promise(resolve => setTimeout(resolve, 10))
      return { status: 200 }
    })).rejects.toThrow('request failed')
    expect(events).toEqual(expect.arrayContaining(['failed:fast-fail', 'completed:slow-peer']))
    expect(events).toContain('blocked:end')
    expect(events).not.toContain('start:end')
  })

  it('routes knowledge through its least-privilege tool and HTTP through the host service', () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'),
      { ...node('knowledge', 'knowledge'), instructions: 'Find the relevant policy' },
      { ...node('http', 'http'), instructions: 'Read the endpoint', config: { url: 'https://example.com' } },
      node('end', 'end'),
    ], [
      { id: 'start-knowledge', source: 'start', target: 'knowledge' },
      { id: 'knowledge-http', source: 'knowledge', target: 'http' },
      { id: 'http-end', source: 'http', target: 'end' },
    ]))
    expect(compiled?.script).toContain('"toolFilter":{"allow":["knowledge_search"]}')
    expect(compiled?.script).toContain('httpRequest({ url: "https://example.com", method: "GET"')
  })

  it('requires a supported URL and method for native HTTP nodes', () => {
    const graph = (config: Record<string, unknown>) => item([
      node('start', 'start'), { ...node('http', 'http'), config }, node('end', 'end'),
    ], [
      { id: 'start-http', source: 'start', target: 'http' },
      { id: 'http-end', source: 'http', target: 'end' },
    ])
    expect(compileWorkflow(graph({ url: '', method: 'GET' }))).toBeUndefined()
    expect(compileWorkflow(graph({ url: 'https://example.com', method: 'OPTIONS' }))).toBeUndefined()
    expect(compileWorkflow(graph({ url: 'https://example.com', method: 'POST' }))?.script).toContain('body: nodeInput')
  })

  it('retries safe HTTP methods on thrown request errors and leaves unsafe methods single-shot', async () => {
    const graph = (method: string) => item([
      node('start', 'start'), { ...node('http', 'http', 2), config: { retries: 2, url: 'https://example.com', method } }, node('end', 'end'),
    ], [
      { id: 'start-http', source: 'start', target: 'http' },
      { id: 'http-end', source: 'http', target: 'end' },
    ])
    const getScript = compileWorkflow(graph('GET'))?.script ?? ''
    expect(getScript).toContain('Retrying http after an HTTP error')
    expect(getScript).toContain('attempt <= 3')
    let attempts = 0
    const execute = new Function('args', 'nodeStart', 'nodeEnd', 'log', 'phase', 'httpRequest', `return (async () => {\n${getScript}\n})()`)
    await expect(execute({}, () => {}, () => {}, () => {}, () => {}, async () => {
      attempts += 1
      if (attempts < 3) throw new Error('transient')
      return { status: 200 }
    })).resolves.toMatchObject({ status: 200 })
    expect(attempts).toBe(3)

    const postScript = compileWorkflow(graph('POST'))?.script ?? ''
    expect(postScript).not.toContain('after an HTTP error')
    expect(postScript).toContain('nodeStart("http", "http", nodeInput, 0)')

    let cancellations = 0
    await expect(execute({}, () => {}, () => {}, () => {}, () => {}, async () => {
      cancellations += 1
      throw Object.assign(new Error('workflow cancelled'), { code: 'CANCELLED' })
    })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(cancellations).toBe(1)
  })

  it('emits structured node audit events while executing a compiled template graph', async () => {
    const compiled = compileWorkflow(item([
      node('start', 'start'), { ...node('template', 'template'), config: { template: 'hello {{input}}' } }, node('end', 'end'),
    ], [
      { id: 'start-template', source: 'start', target: 'template' },
      { id: 'template-end', source: 'template', target: 'end' },
    ]))
    expect(compiled).toBeDefined()
    expect(compiled?.nodeIds).toEqual(['start', 'template', 'end'])
    const events: string[] = []
    const execute = new Function('args', 'nodeStart', 'nodeEnd', 'log', `return (async () => {\n${compiled!.script}\n})()`)
    await expect(execute({ input: 'world' }, (id: string) => { events.push(`start:${id}`) }, (id: string, _label: string, status: string) => { events.push(`${status}:${id}`) }, () => {})).resolves.toBe('hello world')
    expect(events).toEqual(['start:template', 'completed:template', 'start:end', 'completed:end'])
  })
})
