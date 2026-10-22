/** Startup controls for shell documents and a narrow update bridge for app documents. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopApplicationApi, type DshDesktopStartupApi, type DesktopUpdateState } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

const pet: DshDesktopApplicationApi['pet'] = {
  state: () => ipcRenderer.invoke(DESKTOP_IPC.petState) as Promise<Awaited<ReturnType<DshDesktopApplicationApi['pet']['state']>>>,
  subscribe(listener) {
    const handle = (_event: Electron.IpcRendererEvent, state: Parameters<Parameters<DshDesktopApplicationApi['pet']['subscribe']>[0]>[0]): void => { listener(state) }
    ipcRenderer.on(DESKTOP_IPC.petStatePush, handle)
    return () => { ipcRenderer.off(DESKTOP_IPC.petStatePush, handle) }
  },
  drag: (delta) => { void ipcRenderer.invoke(DESKTOP_IPC.petDrag, delta) },
  dragEnd: () => { void ipcRenderer.invoke(DESKTOP_IPC.petDragEnd) },
}

const application: DshDesktopApplicationApi = {
  protocolVersion: 1,
  pet,
  updates: {
    check: () => ipcRenderer.invoke(DESKTOP_IPC.updatesCheck) as Promise<DesktopUpdateState>,
    install: () => ipcRenderer.invoke(DESKTOP_IPC.updatesInstall) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.updatesState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.updatesState, handle) }
    },
  },
}

contextBridge.exposeInMainWorld('dshDesktop', location.protocol === 'dsh-app:' && location.hostname === 'shell'
  ? startup
  : location.protocol === 'dsh-app:' && location.hostname === 'app'
    ? application
    : { protocolVersion: 1 })
