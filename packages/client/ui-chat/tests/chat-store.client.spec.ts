import { describe, expect, it } from 'vitest'
import { createChatStore } from '../src/client/stores.ts'

describe('createChatStore', () => {
  it('stores explicit Turn-process disclosure state', () => {
    const store = createChatStore().create()
    store.actions.setTurnProcessOpen(2, 3, true)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 3, open: true }])

    store.actions.setTurnProcessOpen(2, 4, true)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 4, open: true }])

    store.actions.setTurnProcessOpen(2, 4, false)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 4, open: false }])
  })

  it('closes only the requested Turn-process entry', () => {
    const store = createChatStore().create()
    store.actions.setTurnProcessOpen(2, 3, true)
    store.actions.setTurnProcessOpen(3, 4, true)

    store.actions.setTurnProcessOpen(2, 3, false)
    store.actions.setTurnProcessOpen(9, 10, false)

    expect(store.store.getSnapshot().turnProcesses).toEqual([
      { turn: 2, answerStep: 3, open: false },
      { turn: 3, answerStep: 4, open: true },
      { turn: 9, answerStep: 10, open: false },
    ])
  })
})
