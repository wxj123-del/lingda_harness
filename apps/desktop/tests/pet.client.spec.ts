/**
 * Desktop pet window driver: the polling loop, the settled celebration, the
 * drag handoff to window placement, and teardown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { DesktopPet } from '../src/pet.ts'
import type { PetHost } from '../src/pet.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

interface FakeWindow {
  sent: unknown[]
  position: [number, number]
  destroyed: boolean
  closedHandler: (() => void) | undefined
  webContents: {
    send: (channel: string, payload: unknown) => void
    setWindowOpenHandler: () => void
  }
  setPosition: (x: number, y: number) => void
  getPosition: () => [number, number]
  loadURL: (url: string) => Promise<void>
  isDestroyed: () => boolean
  once: (event: string, handler: () => void) => void
  destroy: () => void
}

function fakeWindow(): FakeWindow {
  const window: FakeWindow = {
    sent: [],
    position: [0, 0],
    destroyed: false,
    closedHandler: undefined,
    webContents: {
      send: (channel, payload) => { window.sent.push({ channel, payload }) },
      setWindowOpenHandler: () => {},
    },
    setPosition: (x, y) => { window.position = [x, y] },
    getPosition: () => window.position,
    loadURL: () => Promise.resolve(),
    isDestroyed: () => window.destroyed,
    once: (event, handler) => { if (event === 'closed') window.closedHandler = handler },
    destroy: () => {
      window.destroyed = true
      window.closedHandler?.()
    },
  }
  return window
}

function listReply(items: readonly unknown[]): Response {
  return Response.json({ type: 'server-response', rpcId: 'x', result: { ok: true, value: { items } } })
}

/** Build one pet whose poll loop is driven by the test's fake timers. */
function build(host: () => PetHost | undefined, position = { x: 100, y: 100 }) {
  const window = fakeWindow()
  let created = 0
  const pet = new DesktopPet({
    locale: resolveDesktopLocale('en'),
    host,
    initialPosition: position,
    createWindow: () => { created += 1; return window as unknown as BrowserWindow },
  })
  return { pet, window, created: () => created }
}

/** Advance fake time and let every queued promise settle. */
async function tick(ms = 2_000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

const runningItem = {
  sessionId: 'a', updatedAt: 1, running: true, blank: false,
  projections: {
    asOfSeq: 2,
    values: {
      title: 'Ship the pet',
      todos: [
        { content: 'cut artwork', status: 'completed' },
        { content: 'poll progress', status: 'in_progress' },
      ],
    },
  },
}

describe('DesktopPet', () => {
  afterEach(() => { vi.useRealTimers() })

  it('loads the pet page, docks at the initial corner, and pushes the first poll', async () => {
    vi.useFakeTimers()
    const fetchHost = vi.fn(async () => listReply([runningItem]))
    const { pet, window, created } = build(() => ({ fetch: fetchHost }), { x: 640, y: 480 })
    pet.start()
    expect(created()).toBe(1)
    expect(window.position).toEqual([640, 480])
    await tick()
    expect(window.sent).toHaveLength(1)
    const pushed = window.sent[0] as { channel: string; payload: unknown }
    expect(pushed.channel).toBe('dsh-desktop:pet-state-push')
    expect(pushed.payload).toMatchObject({
      phase: 'working',
      running: 1,
      task: { title: 'Ship the pet', done: 1, total: 2, current: 'poll progress' },
      text: { headline: 'Working on a task', done: 'All done' },
    })
    pet.dispose()
  })

  it('polls faster while working than while idle', async () => {
    vi.useFakeTimers()
    let items: readonly unknown[] = [runningItem]
    const fetchHost = vi.fn(async () => listReply(items))
    const { pet, window } = build(() => ({ fetch: fetchHost }))
    pet.start()
    await tick(2_000)
    expect(fetchHost).toHaveBeenCalledTimes(1)
    await tick(2_000)
    expect(fetchHost).toHaveBeenCalledTimes(2)
    items = []
    await tick(2_000)
    expect(fetchHost).toHaveBeenCalledTimes(3)
    // The next idle poll is 8s out, not 2s.
    await tick(2_000)
    expect(fetchHost).toHaveBeenCalledTimes(3)
    await tick(6_000)
    expect(fetchHost).toHaveBeenCalledTimes(4)
    expect((window.sent.at(-1) as { payload: { phase: string } }).payload.phase).toBe('idle')
    pet.dispose()
  })

  it('celebrates once when work stops, then falls back to idle', async () => {
    vi.useFakeTimers()
    let items: readonly unknown[] = [runningItem]
    const { pet, window } = build(() => ({ fetch: async () => listReply(items) }))
    pet.start()
    await tick(2_000)
    items = []
    await tick(2_000)
    const phases = window.sent.map(entry => (entry as { payload: { phase: string } }).payload.phase)
    expect(phases).toEqual(['working', 'done'])
    // The celebration holds without new pushes until the idle poll lands.
    await tick(2_000)
    expect(window.sent.map(entry => (entry as { payload: { phase: string } }).payload.phase))
      .toEqual(['working', 'done'])
    await tick(6_000)
    expect(window.sent.map(entry => (entry as { payload: { phase: string } }).payload.phase))
      .toEqual(['working', 'done', 'idle'])
    pet.dispose()
  })

  it('applies drag deltas to the window and records the settled corner', async () => {
    vi.useFakeTimers()
    const savePosition = vi.fn()
    const window = fakeWindow()
    const pet = new DesktopPet({
      locale: resolveDesktopLocale('en'),
      host: () => ({ fetch: async () => listReply([]) }),
      initialPosition: { x: 100, y: 100 },
      savePosition,
      createWindow: () => window as unknown as BrowserWindow,
    })
    pet.start()
    pet.drag({ dx: 12.4, dy: -8.6 })
    expect(window.position).toEqual([112, 91])
    pet.dragEnd()
    expect(savePosition).toHaveBeenCalledWith({ x: 112, y: 91 })
    pet.dragEnd()
    expect(savePosition).toHaveBeenCalledTimes(1)
    pet.dispose()
  })

  it('stands idle while the backend is unavailable and survives a failing host', async () => {
    vi.useFakeTimers()
    const { pet, window } = build(() => undefined)
    pet.start()
    await tick(2_000)
    expect((window.sent[0] as { payload: { phase: string } }).payload.phase).toBe('idle')

    const failing = build(() => ({ fetch: async () => { throw new Error('host restarting') } }))
    failing.pet.start()
    await tick(2_000)
    expect((failing.window.sent[0] as { payload: { phase: string } }).payload.phase).toBe('idle')
    pet.dispose()
    failing.pet.dispose()
  })

  it('stops polling and closes the window on dispose', async () => {
    vi.useFakeTimers()
    const fetchHost = vi.fn(async () => listReply([]))
    const { pet, window } = build(() => ({ fetch: fetchHost }))
    pet.start()
    await tick(2_000)
    const calls = fetchHost.mock.calls.length
    pet.dispose()
    expect(window.destroyed).toBe(true)
    await tick(20_000)
    expect(fetchHost.mock.calls.length).toBe(calls)
  })
})
