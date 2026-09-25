import { contextBridge, ipcRenderer } from 'electron';

// No Node, filesystem, arbitrary IPC, or credentials cross this bridge.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('riDesktop', Object.freeze({
    platform: process.platform,
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('desktop:open-external', url),
  }));
}
