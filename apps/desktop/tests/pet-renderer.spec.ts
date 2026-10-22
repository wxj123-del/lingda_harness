// @vitest-environment jsdom
/**
 * Desktop pet renderer: the bubble follows the pushed phase, the meter tracks
 * the followed task, and pointer gestures become the drag IPC the main process
 * applies to the window.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { DesktopPetView, DshDesktopPetApi } from '../src/ipc.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

type Listener = (state: DesktopPetView) => void

// jsdom replaces the global URL constructor, so build the file paths from
// node:path against this test file instead of `new URL(..., import.meta.url)`.
const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'renderer')
const htmlPath = resolve(rendererRoot, 'pet.html')
const scriptPath = resolve(rendererRoot, 'pet.js')

function pet(initial: DesktopPetView | undefined) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { runScripts: 'outside-only' })
  onTestFinished(() => {
    dom.window.close()
  })
  const listeners = new Set<Listener>()
  const drag = vi.fn()
  const dragEnd = vi.fn()
  const api: DshDesktopPetApi = {
    protocolVersion: 1,
    locale: async () => resolveDesktopLocale('en'),
    pet: {
      state: async () => initial,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      drag,
      dragEnd,
    },
    dismiss: vi.fn(),
  }
  Object.defineProperty(dom.window, 'dshDesktop', { value: api })
  runInContext(readFileSync(scriptPath, 'utf8'), dom.getInternalVMContext())
  const document = dom.window.document
  const element = (selector: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(selector)
    if (found === null) throw new Error(`missing pet element: ${selector}`)
    return found
  }
  const publish = (state: DesktopPetView): void => { for (const listener of listeners) listener(state) }
  return {
    dom, document, element, publish,
    phase: () => element('#pet').dataset.phase,
    headline: () => element('#headline').textContent,
    detail: () => element('#detail').textContent,
    bubbleHidden: () => element('#bubble').hidden,
    meterWidth: () => element('#meter-fill').style.width,
    drag, dragEnd,
  }
}

const working: DesktopPetView = {
  phase: 'working',
  running: 1,
  task: { title: 'Ship the pet', done: 1, total: 4, current: 'poll progress' },
  text: { headline: 'Working on a task', done: 'All done' },
}

it('paints the working phase with its task detail and meter', async () => {
  const page = pet(working)
  await expect.poll(() => page.phase()).toBe('working')
  expect(page.bubbleHidden()).toBe(false)
  expect(page.headline()).toBe('Working on a task')
  expect(page.detail()).toBe('poll progress')
  expect(page.meterWidth()).toBe('25%')
  const sprite = page.element('#sprite')
  expect(sprite.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
  expect(sprite.dataset.phase).toBe('working')
})

it('hides the bubble when idle and shows the settled phase without a meter', async () => {
  const page = pet({ phase: 'idle', running: 0, text: { headline: 'Working on a task', done: 'All done' } })
  await expect.poll(() => page.phase()).toBe('idle')
  expect(page.bubbleHidden()).toBe(true)

  page.publish({ phase: 'done', running: 0, text: { headline: 'Working on a task', done: 'All done' } })
  expect(page.phase()).toBe('done')
  expect(page.bubbleHidden()).toBe(false)
  expect(page.headline()).toBe('All done')
  expect(page.detail()).toBe('')
  expect(page.element('#meter').hasAttribute('hidden')).toBe(true)
  expect(page.element('#sprite').dataset.phase).toBe('done')
})

it('falls back to the title when the task has no in-progress entry', async () => {
  const page = pet(working)
  await expect.poll(() => page.phase()).toBe('working')
  page.publish({
    phase: 'working',
    running: 3,
    task: { title: 'Ship the pet', done: 4, total: 4 },
    text: { headline: 'Working on 3 tasks', done: 'All done' },
  })
  expect(page.headline()).toBe('Working on 3 tasks')
  expect(page.detail()).toBe('Ship the pet')
  expect(page.meterWidth()).toBe('100%')
})

it('forwards pointer movement as a drag delta and ends the gesture', async () => {
  const page = pet(working)
  await expect.poll(() => page.phase()).toBe('working')
  const surface = page.element('#pet')
  // The window's own PointerEvent constructor is untyped in jsdom's
  // declarations; type it at the call site so the gesture stays checked.
  type PointerConstructor = new (type: string, init?: PointerEventInit) => Event
  const PointerEventCtor = (page.dom.window as unknown as { PointerEvent: PointerConstructor }).PointerEvent
  const pointer = (type: string, init: PointerEventInit = {}): Event =>
    new PointerEventCtor(type, { pointerId: 1, bubbles: true, ...init })
  surface.dispatchEvent(pointer('pointerdown', { button: 0 }))
  surface.dispatchEvent(pointer('pointermove'))
  expect(page.drag).toHaveBeenCalledTimes(1)
  const [delta] = page.drag.mock.calls[0] as [{ dx: number; dy: number }]
  expect(typeof delta.dx).toBe('number')
  expect(typeof delta.dy).toBe('number')
  surface.dispatchEvent(pointer('pointerup'))
  expect(page.dragEnd).toHaveBeenCalledTimes(1)
  // A move after the gesture ends must not move the window.
  surface.dispatchEvent(pointer('pointermove'))
  expect(page.drag).toHaveBeenCalledTimes(1)
})
