import { contextBridge, ipcRenderer } from 'electron';
import { onTheme } from './theme-bridge';

// The find bar reports only what to find and where to move. Main accepts it from
// this exact view, frame and page, and the bar never reads the page it searches.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('riLocal', Object.freeze({ onTheme }));
  contextBridge.exposeInMainWorld('riFind', Object.freeze({
    query: (text: string) => ipcRenderer.send('desktop:find', 'query', String(text)),
    next: () => ipcRenderer.send('desktop:find', 'next'),
    previous: () => ipcRenderer.send('desktop:find', 'previous'),
    close: () => ipcRenderer.send('desktop:find', 'close'),
    /** The bar opened, with the text to search again (the last search in this window). */
    onOpen: (callback: (query: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, query: unknown) => { if (typeof query === 'string') callback(query); };
      ipcRenderer.on('desktop:find-open', listener);
      return () => ipcRenderer.removeListener('desktop:find-open', listener);
    },
    /** Where the search stands, such as "3 of 12" or "No results". Empty when there is no search. */
    onResult: (callback: (label: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, label: unknown) => { if (typeof label === 'string') callback(label); };
      ipcRenderer.on('desktop:find-result', listener);
      return () => ipcRenderer.removeListener('desktop:find-result', listener);
    },
  }));
}
