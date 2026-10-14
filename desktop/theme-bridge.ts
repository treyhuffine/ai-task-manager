import { ipcRenderer } from 'electron';

/** Light or dark from the app's appearance, for a local page's `riLocal.onTheme`.
 * Only valid values reach the page, never Electron's event or its sender. */
export function onTheme(callback: (theme: 'light' | 'dark') => void) {
  const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
    if (theme === 'light' || theme === 'dark') callback(theme);
  };
  ipcRenderer.on('desktop:theme', listener);
  return () => ipcRenderer.removeListener('desktop:theme', listener);
}
