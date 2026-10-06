import { contextBridge, ipcRenderer } from 'electron';

// Both local pages use one window. Main authorizes only the active page's
// action domain, exact URL and main frame, regardless of exposed bridge names.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('riCompanion', Object.freeze({
    request: (action: string, value?: unknown): Promise<unknown> => ipcRenderer.invoke('desktop:companion', action, value),
  }));
  contextBridge.exposeInMainWorld('riMaintenance', Object.freeze({
    request: (action: string, value?: unknown): Promise<unknown> => ipcRenderer.invoke('desktop:maintenance', action, value),
  }));
}
