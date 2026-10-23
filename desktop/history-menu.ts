import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
export function historyMenuItems(): MenuItemConstructorOptions[] {
  return (['back', 'forward'] as const).map(direction => ({
    id: `history-${direction}`, label: direction === 'back' ? 'Back' : 'Forward',
    click: (_item, focused) => { void (focused as BrowserWindow | undefined)?.webContents?.executeJavaScript(`window.dispatchEvent(new CustomEvent('ri-history-navigation',{detail:'${direction}'}))`); },
  }));
}
