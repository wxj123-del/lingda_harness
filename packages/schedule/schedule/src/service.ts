/** Remote management and deterministic dispatch for visual-workflow schedules. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import {
  allocateScheduleId,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  decodeScheduleChange,
  foldScheduleEvents,
  ScheduleInputError,
  ScheduleLogError,
  WORKFLOW_SCHEDULE_CHANGE_VERSION,
} from './domain.ts'
import { flushSchedulePersistence, SchedulePersistenceError } from './persistence.ts'
import { runScheduleTransaction } from './transaction.ts'
import type {
  WorkflowScheduleCreateRequest,
  WorkflowScheduleRecord,
  WorkflowScheduleTarget,
} from './types.ts'

/** Starts one retained workflow program when its durable rule becomes due. */
export type WorkflowScheduleDispatcher = (
  agent: Agent,
  target: WorkflowScheduleTarget,
  occurrenceAt: string,
) => Promise<void>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable management and dispatch owner for visual-workflow schedules. */
    workflowSchedules: WorkflowScheduleService
  }
  interface Events {
    /**
     * Requests recomputation after a workflow Schedule mutation.
     * @mode emit
     * @param agent Exact live owner whose runtime must refold.
     */
    'schedule/workflow-refresh': (agent: Agent) => void
    /**
     * Requests recomputation after the workflow dispatcher becomes available.
     * @mode emit
     */
    'schedule/workflow-dispatcher-ready': () => void
  }
}

/** Workflow Schedule Remote and Host dispatcher registry. */
export class WorkflowScheduleService extends TypertRemoteService {
  static inject = ['agents', 'sessions']

  private dispatcher: WorkflowScheduleDispatcher | undefined

  /** @param ctx Host context containing live Agents and Session persistence. */
  constructor(ctx: Context) {
    super(ctx, 'workflowSchedules')
  }

  /**
   * Register the sole workflow starter used by due Schedule records.
   * @param dispatcher - Callback that starts one due workflow.
   * @returns A disposer that releases the registration.
   */
  registerDispatcher(dispatcher: WorkflowScheduleDispatcher): () => void {
    if (this.dispatcher !== undefined) throw new Error('workflow Schedule dispatcher is already registered')
    this.dispatcher = dispatcher
    this.ctx.emit('schedule/workflow-dispatcher-ready')
    return () => { if (this.dispatcher === dispatcher) this.dispatcher = undefined }
  }

  /**
   * Start one due immutable workflow program through the registered execution owner.
   * @param agent - Live root Agent that owns the schedule.
   * @param target - Published workflow target to execute.
   * @param occurrenceAt - ISO timestamp assigned to this occurrence.
   * @returns The dispatch promise.
   */
  dispatch(agent: Agent, target: WorkflowScheduleTarget, occurrenceAt: string): Promise<void> {
    const dispatcher = this.dispatcher
    if (dispatcher === undefined) throw new Error('workflow Schedule dispatcher is unavailable')
    return dispatcher(agent, target, occurrenceAt)
  }

  /**
   * Create one one-shot or fixed-rate trigger for an immutable published workflow.
   * @param agent - Live root Agent that owns the schedule.
   * @param request - Schedule timing and published workflow details.
   * @returns The durable schedule record.
   */
  @Remote('create')
  async create(agent: Agent, request: WorkflowScheduleCreateRequest): Promise<WorkflowScheduleRecord> {
    this.assertLive(agent)
    if (this.dispatcher === undefined) throw new RemoteError('gateway/internal', 'workflow Schedule dispatcher is unavailable', {})
    const hasAt = request.at !== undefined
    const hasEvery = request.everySeconds !== undefined
    if (hasAt === hasEvery) throw new RemoteError('gateway/bad-request', 'exactly one workflow Schedule timing selector is required', {})
    const args = request.args === undefined ? undefined : snapshotJsonValue(request.args)
    if (request.args !== undefined && args === undefined) {
      throw new RemoteError('gateway/bad-request', 'workflow Schedule args must be JSON data', {})
    }
    const target: WorkflowScheduleTarget = {
      kind: 'workflow',
      workflowId: request.workflowId,
      workflowVersion: request.workflowVersion,
      workflowName: request.workflowName,
      script: request.script,
      nodeIds: [...request.nodeIds],
      ...(args === undefined ? {} : { args }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    }
    try {
      return await runScheduleTransaction(agent, async () => {
        await flushSchedulePersistence(this.ctx, agent.session)
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        const folded = foldScheduleEvents(agent.session.ownEvents())
        const id = allocateScheduleId(folded)
        const base = hasAt
          ? createAtScheduleRecord(id, request.label, request.at, Date.now())
          : createEveryScheduleRecord(id, request.label, request.everySeconds as number, Date.now())
        const change = decodeScheduleChange({
          version: WORKFLOW_SCHEDULE_CHANGE_VERSION,
          operation: 'create',
          schedule: { ...base, target },
        })
        if (change.operation !== 'create' || change.version !== WORKFLOW_SCHEDULE_CHANGE_VERSION) {
          throw new ScheduleLogError('workflow Schedule create did not decode as version 2')
        }
        agent.session.append('schedule/change', change)
        await flushSchedulePersistence(this.ctx, agent.session)
        this.ctx.emit('schedule/workflow-refresh', agent)
        return change.schedule
      })
    } catch (error: unknown) {
      throw this.remoteError(error)
    }
  }

  /**
   * List active workflow triggers for the exact Session, optionally filtered by workflow id.
   * @param agent - Live root Agent whose Session is queried.
   * @param workflowId - Optional published workflow identifier filter.
   * @returns Active workflow schedule records.
   */
  @Remote('list')
  async list(agent: Agent, workflowId?: string): Promise<WorkflowScheduleRecord[]> {
    this.assertLive(agent)
    try {
      return await runScheduleTransaction(agent, async () => {
        await flushSchedulePersistence(this.ctx, agent.session)
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        return foldScheduleEvents(agent.session.ownEvents()).active.filter(
          (record): record is WorkflowScheduleRecord => record.target?.kind === 'workflow'
            && (workflowId === undefined || record.target.workflowId === workflowId),
        )
      })
    } catch (error: unknown) {
      throw this.remoteError(error)
    }
  }

  /**
   * Delete one active workflow trigger by its exact Session-local id.
   * @param agent - Live root Agent whose Session is changed.
   * @param id - Session-local schedule identifier.
   * @returns The identifier and whether a record was deleted.
   */
  @Remote('delete')
  async delete(agent: Agent, id: string): Promise<{ readonly id: string; readonly deleted: boolean }> {
    this.assertLive(agent)
    try {
      return await runScheduleTransaction(agent, async () => {
        await flushSchedulePersistence(this.ctx, agent.session)
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        const record = foldScheduleEvents(agent.session.ownEvents()).active.find(candidate => candidate.id === id)
        if (record?.target?.kind !== 'workflow') return { id, deleted: false }
        agent.session.append('schedule/change', {
          version: WORKFLOW_SCHEDULE_CHANGE_VERSION,
          operation: 'delete',
          id: record.id,
        })
        await flushSchedulePersistence(this.ctx, agent.session)
        this.ctx.emit('schedule/workflow-refresh', agent)
        return { id, deleted: true }
      })
    } catch (error: unknown) {
      throw this.remoteError(error)
    }
  }

  /** Reject a stale or non-root Agent identity before reading its log. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent || !this.ctx.agents.roots().includes(agent)) {
      throw new RemoteError('gateway/bad-request', 'workflow Schedule owner is not a live root Session', {})
    }
  }

  /** Map validation and persistence failures to stable Remote categories. */
  private remoteError(error: unknown): RemoteError {
    if (error instanceof RemoteError) return error
    if (error instanceof ScheduleInputError || error instanceof ScheduleLogError) {
      return new RemoteError('gateway/bad-request', error.message, {})
    }
    if (error instanceof SchedulePersistenceError) {
      return new RemoteError('gateway/internal', 'workflow Schedule persistence did not complete', {})
    }
    return new RemoteError('gateway/internal', 'workflow Schedule operation failed', {})
  }
}
