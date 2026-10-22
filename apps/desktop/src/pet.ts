/**
 * The desktop pet: one frameless, transparent, always-on-top window that shows
 * the mascot and, while a task runs, its progress.
 *
 * The window never talks to the Host directly. This module polls the desktop
 * host's own `/api` carrier (`session/list`), folds the reply through
 * {@link resolvePetState}, and pushes the result to the window. That keeps the
 * pet's data path identical to the application's — same carrier, same projection
 * cache — while leaving the pet alive when the main window is hidden.
 */
import type { BrowserWindow } from 'electron'
import { DESKTOP_IPC, type DesktopPetView } from './ipc.ts'
import type { DesktopLocale } from './locale.ts'
import { formatDesktopMessage } from './locale.ts'
import { resolvePetState, sessionListRequestBody } from './pet-state.ts'

/** Poll cadence while a task runs, and while the pet is idle. */
const WORKING_POLL_MS = 2_000
const IDLE_POLL_MS = 8_000

/** How long the settled phase stays on screen before returning to idle. */
const CELEBRATION_MS = 6_000

/** Fetch shape this module needs from the desktop host. */
export interface PetHost {
  fetch(request: Request): Promise<Response>
}

/** One point on the desktop. */
export interface PetPoint {
  readonly x: number
  readonly y: number
}

/** Options for {@link DesktopPet}. */
export interface DesktopPetOptions {
  /** Locale copy for the bubble. */
  readonly locale: DesktopLocale
  /** Host access, present only while the backend is ready. */
  readonly host: () => PetHost | undefined
  /** Create the window once the app is ready. */
  readonly createWindow: () => BrowserWindow
  /** Initial top-left corner when there is no restored position. */
  readonly initialPosition: PetPoint
  /** Persisted top-left corner, if the user moved the pet before. */
  readonly restorePosition?: () => PetPoint | undefined
  /** Record the top-left corner after a drag. */
  readonly savePosition?: (position: PetPoint) => void
}

/** One window's pet surface plus the polling loop behind it. */
export class DesktopPet {
  private window: BrowserWindow | undefined
  private latest: DesktopPetView | undefined
  // Node timers (the driver's environment); `unref` keeps a pending poll from
  // holding the process open during shutdown.
  private timer: ReturnType<typeof setTimeout> | undefined
  private celebrationTimer: ReturnType<typeof setTimeout> | undefined
  private celebrating = false
  private dragging = false
  private disposed = false

  /** @param options - locale copy, host access, and window lifecycle hooks. */
  constructor(private readonly options: DesktopPetOptions) {}

  /** Show the pet window and start polling. */
  start(): void {
    const window = this.options.createWindow()
    this.window = window
    window.once('closed', () => {
      if (this.window === window) this.window = undefined
    })
    const restored = this.options.restorePosition?.() ?? this.options.initialPosition
    window.setPosition(restored.x, restored.y)
    void window.loadURL('dsh-app://shell/pet.html').catch((error: unknown) => {
      console.error('desktop pet: load failed', error)
    })
    this.schedule(WORKING_POLL_MS)
  }

  /** Current view, for a renderer that asks after the push already happened. */
  get state(): DesktopPetView | undefined { return this.latest }

  /**
   * Move the window by one pointer delta.
   * @param delta - screen-pixel movement since the previous move event.
   */
  drag(delta: { readonly dx: number; readonly dy: number }): void {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const [x, y] = window.getPosition()
    window.setPosition(Math.round((x ?? 0) + delta.dx), Math.round((y ?? 0) + delta.dy))
    this.dragging = true
  }

  /** Finish one drag and persist the settled corner. */
  dragEnd(): void {
    const window = this.window
    if (!this.dragging || window === undefined || window.isDestroyed()) return
    this.dragging = false
    const [x, y] = window.getPosition()
    this.options.savePosition?.({ x: x ?? 0, y: y ?? 0 })
  }

  /** Stop polling and close the window. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.celebrationTimer !== undefined) clearTimeout(this.celebrationTimer)
    this.timer = undefined
    this.celebrationTimer = undefined
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  /** Arm the next poll, spacing idle polls further apart than working ones. */
  private schedule(delay: number): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.poll() }, delay)
    this.timer.unref()
  }

  /** Read the Session list through the host, then publish the folded state. */
  private async poll(): Promise<void> {
    if (this.disposed) return
    const folded = await this.read()
    const celebrating = this.track(folded.phase)
    const state = this.view(folded, celebrating)
    this.latest = state
    const window = this.window
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send(DESKTOP_IPC.petStatePush, state)
    }
    this.schedule(state.phase === 'working' ? WORKING_POLL_MS : IDLE_POLL_MS)
  }

  /**
   * Poll the host once.
   * @returns the folded state, or an idle stand-in while the backend restarts.
   */
  private async read(): Promise<ReturnType<typeof resolvePetState>> {
    const host = this.options.host()
    if (host === undefined) return { phase: 'idle', running: 0 }
    try {
      const response = await host.fetch(new Request('dsh-app://app/api/session/list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: sessionListRequestBody(`pet-${String(Date.now())}`),
      }))
      if (!response.ok) return { phase: 'idle', running: 0 }
      return resolvePetState(await response.json())
    } catch (error) {
      // A host that is restarting rejects the fetch; the next tick retries.
      console.error('desktop pet: progress poll failed', error)
      return { phase: 'idle', running: 0 }
    }
  }

  /**
   * Latch the settled phase briefly: work that was running and stopped shows
   * one celebration, then falls back to idle.
   * @param phase - the freshly folded phase.
   * @returns whether this frame renders the celebration.
   */
  private track(phase: DesktopPetView['phase']): boolean {
    if (phase === 'working') {
      this.celebrating = false
      if (this.celebrationTimer !== undefined) clearTimeout(this.celebrationTimer)
      this.celebrationTimer = undefined
      return false
    }
    if (this.celebrating) return true
    if (!this.wasWorking) return false
    this.celebrating = true
    this.celebrationTimer = setTimeout(() => {
      this.celebrating = false
      this.celebrationTimer = undefined
      this.schedule(0)
    }, CELEBRATION_MS)
    this.celebrationTimer.unref()
    return true
  }

  /** Whether the previous frame was showing work. */
  private wasWorking = false

  /**
   * Attach locale copy to one folded state.
   * @param folded - phase and tallies from {@link resolvePetState}.
   * @param celebrating - render the settled phase.
   * @returns the renderable view.
   */
  private view(
    folded: ReturnType<typeof resolvePetState>,
    celebrating: boolean,
  ): DesktopPetView {
    const messages = this.options.locale.messages
    const phase = celebrating ? 'done' : folded.phase
    this.wasWorking = folded.phase === 'working'
    return {
      phase,
      running: folded.running,
      ...(folded.task === undefined ? {} : { task: folded.task }),
      text: {
        headline: folded.running > 1
          ? formatDesktopMessage(messages.petWorkingMany, { n: String(folded.running) })
          : messages.petWorking,
        done: messages.petDone,
      },
    }
  }
}
