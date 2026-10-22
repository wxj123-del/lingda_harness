/** Desktop pet bridge: the mascot's state stream plus its drag gestures. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DesktopPetView, type DshDesktopPetApi } from './ipc.ts'
import type { DesktopLocale } from './locale.ts'

const api: DshDesktopPetApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as Promise<DesktopLocale>,
  pet: {
    state: () => ipcRenderer.invoke(DESKTOP_IPC.petState) as Promise<DesktopPetView | undefined>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopPetView): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.petStatePush, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.petStatePush, handle) }
    },
    drag: (delta) => { void ipcRenderer.invoke(DESKTOP_IPC.petDrag, delta) },
    dragEnd: () => { void ipcRenderer.invoke(DESKTOP_IPC.petDragEnd) },
  },
  dismiss: () => { void ipcRenderer.invoke(DESKTOP_IPC.petToggle, false) },
}

contextBridge.exposeInMainWorld('dshDesktop', api)
