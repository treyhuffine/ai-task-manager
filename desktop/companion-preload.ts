import { contextBridge, ipcRenderer } from 'electron';

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('riCompanion', Object.freeze({
    request: (action: string, value?: unknown) => ipcRenderer.invoke('desktop:companion', action, value),
  }));
}
