import { contextBridge, ipcRenderer } from 'electron';

// No Node, filesystem, arbitrary IPC, or credentials cross this bridge.
if (process.isMainFrame) {
  const local = ipcRenderer.sendSync('desktop:bridge-mode') === 'local';
  contextBridge.exposeInMainWorld('riDesktop', Object.freeze({
    platform: process.platform,
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('desktop:open-external', url),
    ...(local ? {
      notifications: (action: unknown) => ipcRenderer.invoke('desktop:notifications', action),
      settings: (action: unknown) => ipcRenderer.invoke('desktop:settings', action),
    } : {}),
    onQuickCapture: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('desktop:quick-capture', listener);
      ipcRenderer.send('desktop:capture-ready');
      return () => ipcRenderer.removeListener('desktop:quick-capture', listener);
    },
    onPrepareBackground: (callback: () => boolean) => {
      const listener = (_event: Electron.IpcRendererEvent, nonce: string) => {
        let ok = false;
        try { ok = callback() === true; } catch { /* Keep the window reachable. */ }
        ipcRenderer.send('desktop:background-ready', { nonce, ok });
      };
      ipcRenderer.on('desktop:prepare-background', listener);
      return () => ipcRenderer.removeListener('desktop:prepare-background', listener);
    },
    onResume: (callback: () => void) => {
      // Never pass Electron's IPC event (and its sender) into page callbacks.
      const listener = () => callback();
      ipcRenderer.on('desktop:resume', listener);
      return () => ipcRenderer.removeListener('desktop:resume', listener);
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
