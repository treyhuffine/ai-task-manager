import { contextBridge, ipcRenderer } from 'electron';

if (process.isMainFrame) contextBridge.exposeInMainWorld('riMaintenance', Object.freeze({
  request: (action: string, value?: unknown): Promise<unknown> => ipcRenderer.invoke('desktop:maintenance', action, value),
}));
