/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { DesktopBackendState } from './backend-controller.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  localeGet: 'dsh-desktop:locale-get',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  pluginsToggle: 'dsh-desktop:plugins-toggle',
  pluginsDisableAll: 'dsh-desktop:plugins-disable-all',
  backendStatus: 'dsh-desktop:backend-status',
  backendRetry: 'dsh-desktop:backend-retry',
  applicationRestart: 'dsh-desktop:application-restart',
  configurationReset: 'dsh-desktop:configuration-reset',
  backendState: 'dsh-desktop:backend-state',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
  petState: 'dsh-desktop:pet-state',
  petStatePush: 'dsh-desktop:pet-state-push',
  petDrag: 'dsh-desktop:pet-drag',
  petDragEnd: 'dsh-desktop:pet-drag-end',
  petToggle: 'dsh-desktop:pet-toggle',
  petVisible: 'dsh-desktop:pet-visible',
} as const

/** What the pet window renders; produced by the main process from the Session list. */
export interface DesktopPetView {
  readonly phase: 'idle' | 'working' | 'done'
  /** Running, non-blank Sessions behind this summary. */
  readonly running: number
  /** Tally of the Session the pet follows, when it has a todo list. */
  readonly task?: {
    readonly title?: string
    readonly done: number
    readonly total: number
    readonly current?: string
  }
  /** Locale-resolved copy for this frame. */
  readonly text: {
    readonly headline: string
    readonly done: string
  }
}

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    disableAll(): Promise<void>
  }
  readonly backend: {
    status(): Promise<DesktopBackendState>
    retry(): Promise<void>
    subscribe(listener: (state: DesktopBackendState) => void): () => void
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
  /** The mounted pet window: its state stream and the drag gestures it forwards. */
  readonly pet: {
    state(): Promise<DesktopPetView | undefined>
    subscribe(listener: (state: DesktopPetView) => void): () => void
    /** Move the window by one pointer delta in screen pixels. */
    drag(delta: { readonly dx: number; readonly dy: number }): void
    /** End one drag gesture. */
    dragEnd(): void
  }
}

/** The pet window's own bridge: state plus temporary visibility control. */
export interface DshDesktopPetApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale' | 'pet'> {
  /** Hide the pet until the next launch. */
  dismiss(): void
}

/** The narrow bridge exposed to the application renderer. */
export type DshDesktopApplicationApi = Pick<DshDesktopApi, 'protocolVersion' | 'updates' | 'pet'>

/** Startup-page controls, unavailable to backend-provided application documents. */
export interface DshDesktopStartupApi extends Pick<DshDesktopApi, 'protocolVersion' | 'locale'> {
  readonly backend: Omit<DshDesktopApi['backend'], 'retry'>
  disablePlugins(): Promise<void>
  restart(): Promise<void>
  resetConfiguration(): Promise<void>
}
