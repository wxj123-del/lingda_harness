import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowMeta, WorkflowNodeEndInfo, WorkflowNodeStartInfo, WorkflowResult } from '@deepseek-ai/dsh-workflow'
import { describe, expect, it, vi } from 'vitest'
import SessionController from '../src/index.ts'
import type { WorkflowNodeAudit, WorkflowRemoteRunView } from '../src/types.ts'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

describe('SessionController facade', () => {
  it('does not require the Tools service', () => {
    expect(SessionController.inject).not.toContain('tools')
  })

  it('owns Host service methods and publishes Agent lifecycle projections', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('controller-session')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      cwd: '/workspace',
      isSeeded: false,
    }
    const events: SessionEvent[] = []
    const inspect = vi.fn(() => Promise.resolve({
      meta: header,
      inheritedEventCount: SessionLogOffset(0),
      events,
    }))
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect,
    }) as never)
    let uploadResolver: ((sessionId: SessionId) => Promise<Agent>) | undefined
    ctx.provide('fileUploads', {
      registerAgentResolver: (resolve: (sessionId: SessionId) => Promise<Agent>) => {
        uploadResolver = resolve
        return () => {}
      },
      resolve: () => undefined,
      bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
      retirePrompt: () => {},
    } as never)
    const controller = createSessionTestController(ctx, defaults)
    const status = vi.fn()
    const failure = vi.fn()
    const activity = vi.fn()
    ctx.on('api-session/status', status)
    ctx.on('api-session/error', failure)
    ctx.on('api-session/activity', activity)

    await expect(controller.inspect(sessionId)).resolves.toEqual({
      meta: header,
      inheritedEventCount: SessionLogOffset(0),
      events,
    })
    expect(inspect).toHaveBeenCalledOnce()

    const session = ctx.sessions.create(sessionId, { meta: header })
    const agent = {
      id: sessionId,
      session,
      status: 'idle',
      ctx,
    } as Agent
    await ctx.agents.register(agent)
    const resolveUploadAgent = (id: SessionId): Promise<Agent> => {
      if (uploadResolver === undefined) throw new Error('file upload resolver was not registered')
      return uploadResolver(id)
    }
    await expect(resolveUploadAgent(sessionId)).resolves.toBe(agent)
    const activationError = new RemoteError('session/not-found', 'missing upload session', { sessionId })
    vi.spyOn(
      (controller as unknown as { agents: ApiSessionAgentController }).agents,
      'resolveAgent',
    ).mockResolvedValueOnce({ error: activationError })
    await expect(resolveUploadAgent(sessionId)).rejects.toBe(activationError)
    const consumeSelection = vi.spyOn(
      (controller as unknown as { agents: ApiSessionAgentController }).agents,
      'consumeSelection',
    )

    await expect(controller.resolveAgent(sessionId)).resolves.toEqual({ agent })
    await expect(controller.inspect(sessionId)).resolves.toEqual({
      meta: header,
      inheritedEventCount: SessionLogOffset(0),
      events,
    })
    expect(inspect).toHaveBeenCalledOnce()
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/error', { agent, turn: 1, step: 0, error: new Error('fixture failure') })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'browser prompt' }],
      source: { kind: 'user', rpcId: 'controller-rpc' as never },
    }), { surfaceOp: 'append' })
    expect(status).toHaveBeenCalledWith(sessionId, true)
    expect(failure).toHaveBeenCalledWith(sessionId, expect.stringContaining('fixture failure'))
    expect(activity).toHaveBeenCalledWith(sessionId, expect.any(Number))
    session.append('request/header', {
      header: { config: { provider: 'fixture', model: 'fixture-model' } },
      reason: 'initial',
    })
    expect(consumeSelection).toHaveBeenCalledWith(
      agent, 'fixture', 'fixture-model', undefined,
    )
    const unowned = ctx.sessions.create(SessionId('controller-unowned'), {
      meta: { cwd: '/workspace' },
    })
    unowned.append('request/header', {
      header: { config: { provider: 'fixture', model: 'other-model' } },
      reason: 'initial',
    })
    expect(consumeSelection).toHaveBeenCalledTimes(1)

    const abort = new AbortController()
    const iterator = controller.follow({
      address: { kind: 'session', sessionId },
    }, abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'snapshot', cursor: 2 },
    })
    abort.abort()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('reads visual workflow run history from the Session event log', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('workflow-history-session')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      cwd: '/workspace',
      isSeeded: false,
    }
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    }) as never)
    const controller = createSessionTestController(ctx, defaults)
    const session = ctx.sessions.create(sessionId, { meta: header })
    const view: WorkflowRemoteRunView = {
      runId: WorkflowRunId('persisted-run'),
      workflowId: 'fixture-workflow',
      name: 'Fixture workflow',
      status: 'completed',
      startedAt: 10,
      endedAt: 20,
      agentsStarted: 1,
      source: 'visual-editor',
      value: { ok: true },
    }
    session.append('visual-workflow/run', view)

    await expect(controller.workflowList(sessionId, { limit: 10 })).resolves.toEqual({ runs: [view] })
    await expect(controller.workflowStatus({ sessionId, runId: view.runId })).resolves.toEqual(view)
    await expect(controller.workflowCancel({ sessionId, runId: view.runId }))
      .rejects.toThrow('is no longer running')
  })

  it('recovers visual workflow history from a cold persisted Session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('cold-workflow-history-session')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      cwd: '/workspace',
      isSeeded: false,
    }
    const persisted = Session.create(sessionId, [], header)
    const view: WorkflowRemoteRunView = {
      runId: WorkflowRunId('cold-persisted-run'),
      workflowId: 'fixture-workflow',
      name: 'Fixture workflow',
      status: 'completed',
      startedAt: 30,
      endedAt: 40,
      agentsStarted: 0,
      source: 'visual-editor',
    }
    persisted.append('visual-workflow/run', view)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: persisted.snapshotEvents() }),
    }) as never)
    const controller = createSessionTestController(ctx, defaults)

    await expect(controller.workflowList(sessionId, { workflowId: 'fixture-workflow' }))
      .resolves.toEqual({ runs: [view] })
    await expect(controller.workflowStatus({ sessionId, runId: view.runId })).resolves.toEqual(view)
  })

  it('folds incremental node audit events into the latest run checkpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('incremental-workflow-history-session')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      cwd: '/workspace',
      isSeeded: false,
    }
    const persisted = Session.create(sessionId, [], header)
    const runId = WorkflowRunId('incremental-run')
    const start: WorkflowNodeAudit = {
      correlationId: runId,
      nodeId: 'input',
      label: 'Input',
      status: 'running',
      startedAt: 50,
      retryCount: 0,
      inputSummary: '{"value":1}',
    }
    const end: WorkflowNodeAudit = {
      ...start,
      status: 'completed',
      endedAt: 55,
      durationMs: 5,
      outputSummary: '{"value":2}',
    }
    const initial: WorkflowRemoteRunView = {
      runId,
      workflowId: 'fixture-workflow',
      name: 'Fixture workflow',
      status: 'running',
      startedAt: 40,
      agentsStarted: 0,
      source: 'visual-editor',
      audit: [],
    }
    const terminal: WorkflowRemoteRunView = { ...initial, status: 'completed', endedAt: 60, audit: [end] }
    persisted.append('visual-workflow/run', initial)
    persisted.append('visual-workflow/node', start)
    persisted.append('visual-workflow/node', end)
    persisted.append('visual-workflow/run', terminal)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: persisted.snapshotEvents() }),
    }) as never)
    const controller = createSessionTestController(ctx, defaults)

    await expect(controller.workflowStatus({ sessionId, runId })).resolves.toEqual({
      ...terminal,
      audit: [end],
    })
  })

  it('marks an orphaned persisted running workflow as interrupted after restart', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('orphaned-workflow-session')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      cwd: '/workspace',
      isSeeded: false,
    }
    const persisted = Session.create(sessionId, [], header)
    const running: WorkflowRemoteRunView = {
      runId: WorkflowRunId('orphaned-run'),
      workflowId: 'fixture-workflow',
      name: 'Fixture workflow',
      status: 'running',
      startedAt: 50,
      agentsStarted: 1,
      source: 'visual-editor',
    }
    persisted.append('visual-workflow/run', running)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: persisted.snapshotEvents() }),
    }) as never)
    const controller = createSessionTestController(ctx, defaults)

    await expect(controller.workflowStatus({ sessionId, runId: running.runId })).resolves.toMatchObject({
      runId: running.runId,
      status: 'error',
      error: 'Host restarted before this workflow run completed',
    })
  })

  it('writes start and terminal checkpoints for a live workflow run', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('workflow-checkpoint-session')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 1,
      cwd: '/workspace',
      isSeeded: false,
    }
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, events: [] }),
    }) as never)
    const controller = createSessionTestController(ctx, defaults)
    const session = ctx.sessions.create(sessionId, { meta: header })
    let settle!: (result: WorkflowResult) => void
    const result = new Promise<WorkflowResult>((resolve) => { settle = resolve })
    const meta: WorkflowMeta = { name: 'fixture-workflow', description: 'Fixture workflow' }
    const run = {
      id: WorkflowRunId('checkpoint-run'),
      meta,
      result,
      cancel: vi.fn(),
      dispose: vi.fn(async () => {}),
    }
    ctx.provide('workflowEngine', { start: vi.fn(() => run) } as never)
    await ctx.agents.register({ id: sessionId, session, status: 'idle', ctx } as Agent)

    await expect(controller.workflowStart({
      sessionId,
      workflowId: 'fixture-workflow',
      script: 'return null',
      nodeIds: ['input', 'input'],
      meta,
    })).rejects.toMatchObject({ code: 'gateway/bad-request' })

    await expect(controller.workflowStart({
      sessionId,
      workflowId: 'fixture-workflow',
      script: 'return null',
      nodeIds: ['input', 'downstream'],
      workflowVersion: 2,
      meta,
    })).resolves.toMatchObject({ runId: run.id, status: 'running' })
    expect(session.snapshotEvents().filter(event => event.type === 'visual-workflow/run')).toHaveLength(1)
    expect(session.snapshotEvents().find(event => event.type === 'visual-workflow/run')?.data).toMatchObject({ workflowVersion: 2 })

    const nodeStart: WorkflowNodeStartInfo = {
      nodeId: 'input', label: 'Input', retryCount: 0, startedAt: 10,
    }
    const nodeEnd: WorkflowNodeEndInfo = {
      ...nodeStart, status: 'completed', endedAt: 12, durationMs: 2, outputSummary: 'ok',
    }
    ctx.emit('workflow/node-start', { id: run.id, meta }, nodeStart)
    ctx.emit('workflow/node-end', { id: run.id, meta }, nodeEnd)
    ctx.emit('workflow/node-end', { id: run.id, meta }, {
      nodeId: 'downstream', label: 'Downstream', status: 'blocked', retryCount: 0, startedAt: 13, endedAt: 13, durationMs: 0,
    })
    ctx.emit('workflow/node-start', { id: run.id, meta }, {
      nodeId: 'forged', label: 'Forged', retryCount: 0, startedAt: 14,
    })
    expect(session.snapshotEvents().filter(event => event.type === 'visual-workflow/node')).toHaveLength(3)
    expect(session.snapshotEvents().filter(event => event.type === 'visual-workflow/run')).toHaveLength(1)
    await expect(controller.workflowList(sessionId, { limit: 10 })).resolves.toMatchObject({ runs: [{ runId: run.id }] })

    settle({ value: { ok: true }, stopReason: 'completed', agentsStarted: 0 })
    await vi.waitFor(() => {
      const checkpoints = session.snapshotEvents().filter(event => event.type === 'visual-workflow/run')
      expect(checkpoints).toHaveLength(2)
      expect(checkpoints.at(-1)?.data).toMatchObject({ runId: run.id, status: 'completed', value: { ok: true } })
    })
  })

  it.each(['success', 'domain-error', 'throw'] as const)(
    'promotes a prepared follow observation in the background: %s',
    async (outcome) => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(AgentRegistry)
      const sessionId = SessionId(`background-${outcome}`)
      const header: SessionHeader = {
        version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd: '/workspace', isSeeded: false,
      }
      ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
        list: () => Promise.resolve([header]),
        inspect: () => Promise.resolve({
          meta: header,
          inheritedEventCount: SessionLogOffset(0),
          events: [],
        }),
      }) as never)
      const controller = createSessionTestController(ctx, defaults)
      const agents = (controller as unknown as { agents: ApiSessionAgentController }).agents
      const apiError = vi.fn()
      ctx.on('api-session/error', apiError)
      const logError = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
      const live = { id: sessionId, session: { id: sessionId }, ctx, status: 'idle' } as unknown as Agent
      const resolve = vi.spyOn(agents, 'resolveObservedAgent')
      if (outcome === 'success') resolve.mockResolvedValue({ agent: live })
      else if (outcome === 'domain-error') {
        resolve.mockResolvedValue({
          error: new RemoteError('gateway/internal', 'activation unavailable', {}),
        })
      } else {
        resolve.mockRejectedValue(new Error('activation crashed'))
      }
      const abort = new AbortController()
      const iterator = controller.follow({
        address: { kind: 'session', sessionId },
      }, abort.signal)[Symbol.asyncIterator]()

      await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
      const waiting = iterator.next()
      await vi.waitFor(() => { expect(resolve).toHaveBeenCalledOnce() })
      if (outcome === 'domain-error') {
        await vi.waitFor(() => {
          expect(apiError).toHaveBeenCalledWith(sessionId, 'activation unavailable')
        })
      } else if (outcome === 'throw') {
        await vi.waitFor(() => {
          expect(logError).toHaveBeenCalledWith(expect.stringContaining('activation crashed'))
        })
      } else {
        expect(apiError).not.toHaveBeenCalled()
      }
      abort.abort()
      await expect(waiting).resolves.toMatchObject({ done: true })
      await ctx.fiber.dispose()
    },
  )

  it('waits for an admitted background promotion during teardown', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('background-disposal')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd: '/workspace', isSeeded: false,
    }
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({
        meta: header,
        inheritedEventCount: SessionLogOffset(0),
        events: [],
      }),
    }) as never)
    const controller = createSessionTestController(ctx, defaults)
    const agents = (controller as unknown as { agents: ApiSessionAgentController }).agents
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(agents, 'resolveObservedAgent').mockImplementation(async () => {
      started.resolve(undefined)
      await release.promise
      return {
        agent: { id: sessionId, session: { id: sessionId }, ctx, status: 'idle' } as unknown as Agent,
      }
    })
    const iterator = controller.follow({
      address: { kind: 'session', sessionId },
    }, new AbortController().signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
    const waiting = iterator.next()
    await started.promise
    let disposed = false
    const disposal = ctx.fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    release.resolve(undefined)
    await disposal
    await expect(waiting).resolves.toMatchObject({ done: true })
  })
})
