import { contextBridge, ipcRenderer } from 'electron';

// Local pages occupy an isolated view within the native window. Main authorizes only the active page's
// action domain, exact URL and main frame, regardless of exposed bridge names.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('riLocal', Object.freeze({
    onTheme: (callback: (theme: 'light' | 'dark') => void) => {
      const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
        if (theme === 'light' || theme === 'dark') callback(theme);
      };
      ipcRenderer.on('desktop:theme', listener);
      return () => ipcRenderer.removeListener('desktop:theme', listener);
    },
  }));
  contextBridge.exposeInMainWorld('riCompanion', Object.freeze({
    request: (action: string, value?: unknown): Promise<unknown> => ipcRenderer.invoke('desktop:companion', action, value),
  }));
  contextBridge.exposeInMainWorld('riMaintenance', Object.freeze({
    request: (action: string, value?: unknown): Promise<unknown> => ipcRenderer.invoke('desktop:maintenance', action, value),
  }));
}
