import { contextBridge, ipcRenderer } from 'electron';

// No Node, filesystem, arbitrary IPC, or credentials cross this bridge.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('riDesktop', Object.freeze({
    platform: process.platform,
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('desktop:open-external', url),
    onResume: (callback: () => void) => {
      ipcRenderer.on('desktop:resume', callback);
      return () => ipcRenderer.removeListener('desktop:resume', callback);
    },
    onPrepareClose: (callback: () => Promise<boolean>) => {
      const listener = (_event: Electron.IpcRendererEvent, nonce: string) => {
        void Promise.resolve().then(callback).then(ok => {
          ipcRenderer.send('desktop:prepared', { nonce, ok: ok === true });
        }, () => ipcRenderer.send('desktop:prepared', { nonce, ok: false }));
      };
      ipcRenderer.on('desktop:prepare-close', listener);
      return () => ipcRenderer.removeListener('desktop:prepare-close', listener);
    },
  }));
}
