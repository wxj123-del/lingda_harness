/**
 * Desktop pet state folding: which Session the pet follows, how the todo
 * projection becomes a tally, and how a missing or failed reply degrades.
 */
import { describe, expect, it } from 'vitest'
import { resolvePetState, sessionListRequestBody } from '../src/pet-state.ts'

function reply(items: readonly unknown[]): unknown {
  return { type: 'server-response', rpcId: 'x', result: { ok: true, value: { items } } }
}

describe('resolvePetState', () => {
  it('reports idle when nothing is running', () => {
    expect(resolvePetState(reply([
      { sessionId: 'a', updatedAt: 1, running: false, blank: false },
      { sessionId: 'b', updatedAt: 2, running: false, blank: true },
    ]))).toEqual({ phase: 'idle', running: 0 })
  })

  it('ignores blank Sessions that report running', () => {
    expect(resolvePetState(reply([
      { sessionId: 'a', updatedAt: 1, running: true, blank: true },
    ]))).toEqual({ phase: 'idle', running: 0 })
  })

  it('counts running Sessions and reports the newest todo tally', () => {
    const state = resolvePetState(reply([
      {
        sessionId: 'old', updatedAt: 10, running: true, blank: false,
        projections: { asOfSeq: 3, values: { todos: [{ content: 'old step', status: 'in_progress' }] } },
      },
      {
        sessionId: 'new', updatedAt: 99, running: true, blank: false,
        projections: {
          asOfSeq: 7,
          values: {
            title: 'Ship the pet',
            todos: [
              { content: 'cut artwork', status: 'completed' },
              { content: 'wire the window', status: 'completed' },
              { content: 'poll progress', status: 'in_progress' },
              { content: 'write notes', status: 'pending' },
            ],
          },
        },
      },
      { sessionId: 'idle', updatedAt: 5, running: false, blank: false },
    ]))
    expect(state.phase).toBe('working')
    expect(state.running).toBe(2)
    expect(state.task).toEqual({ title: 'Ship the pet', done: 2, total: 4, current: 'poll progress' })
  })

  it('animates a running Session that has no todo list', () => {
    const state = resolvePetState(reply([
      { sessionId: 'a', updatedAt: 1, running: true, blank: false },
    ]))
    expect(state).toEqual({ phase: 'working', running: 1 })
  })

  it('prefers a running Session with a todo list over one without', () => {
    const state = resolvePetState(reply([
      { sessionId: 'bare', updatedAt: 50, running: true, blank: false },
      {
        sessionId: 'todo', updatedAt: 10, running: true, blank: false,
        projections: { asOfSeq: 1, values: { todos: [{ content: 'only step', status: 'in_progress' }] } },
      },
    ]))
    expect(state.task).toEqual({ done: 0, total: 1, current: 'only step' })
  })

  it('degrades to idle on failures and malformed replies', () => {
    expect(resolvePetState(undefined)).toEqual({ phase: 'idle', running: 0 })
    expect(resolvePetState({ result: { ok: false, error: { code: 'gateway/internal', message: '', details: {} } } }))
      .toEqual({ phase: 'idle', running: 0 })
    expect(resolvePetState(reply([]))).toEqual({ phase: 'idle', running: 0 })
    expect(resolvePetState({ result: { ok: true, value: { items: 'nope' } } }))
      .toEqual({ phase: 'idle', running: 0 })
  })

  it('skips malformed todo entries instead of failing the tally', () => {
    const state = resolvePetState(reply([{
      sessionId: 'a', updatedAt: 1, running: true, blank: false,
      projections: {
        asOfSeq: 1,
        values: { todos: [null, { content: '', status: 'completed' }, { content: 'real', status: 'pending' }] },
      },
    }]))
    expect(state.task).toEqual({ done: 1, total: 3 })
  })

  it('builds the RPC envelope the desktop host answers', () => {
    expect(JSON.parse(sessionListRequestBody('rpc-1'))).toEqual({
      type: 'client-request',
      rpcId: 'rpc-1',
      method: 'session/list',
      payload: { args: { _request: {} } },
    })
  })
})
