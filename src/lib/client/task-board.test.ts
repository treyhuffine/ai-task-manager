import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { boardFromSearch, openBoard, openTaskBoard, closeTaskBoard, clearBoardFocus, syncBoardFromUrl, BOARD_VIEW_KEY } from './task-board';

const storage = new Map<string, string>();
let url: URL;
beforeEach(() => {
  url = new URL('http://localhost/executions/example?keep=yes#context');
  storage.clear();
  vi.stubGlobal('window', {
    get location() { return { href: url.href, search: url.search }; },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    history: { replaceState: (_state: unknown, _title: string, next: string) => { url = new URL(next, url); } },
  });
  syncBoardFromUrl();
});
afterEach(() => { closeTaskBoard(); vi.unstubAllGlobals(); });

describe('Board entry contract', () => {
  it('defaults the general entry to Agent Activity and remembers explicit Tasks', () => {
    openBoard();
    expect(url.searchParams.get('board')).toBe('activity');
    expect(url.searchParams.get('keep')).toBe('yes');
    expect(url.hash).toBe('#context');
    closeTaskBoard();
    openTaskBoard();
    expect(storage.get(BOARD_VIEW_KEY)).toBe('tasks');
    closeTaskBoard();
    openBoard();
    expect(url.searchParams.get('board')).toBe('tasks');
  });
  it('preserves legacy Tasks links and validates activity focus', () => {
    expect(boardFromSearch('?board=1')).toEqual({ open: true, view: 'tasks', focusBucket: null });
    expect(boardFromSearch('?board=activity&boardFocus=unread')?.focusBucket).toBe('unread');
    expect(boardFromSearch('?board=tasks&boardFocus=unread')?.focusBucket).toBeNull();
    expect(boardFromSearch('?board=activity&boardFocus=invalid')?.focusBucket).toBeNull();
    expect(boardFromSearch('?other=1')).toBeNull();
  });
  it('restores a linked view on reload and lets HUD expansion override the remembered view', () => {
    url.searchParams.set('board', 'tasks');
    syncBoardFromUrl();
    expect(storage.get(BOARD_VIEW_KEY)).toBe('tasks');
    openBoard({ focusBucket: 'needsApproval' });
    expect(url.searchParams.get('board')).toBe('activity');
    expect(url.searchParams.get('boardFocus')).toBe('needsApproval');
    clearBoardFocus();
    expect(url.searchParams.has('boardFocus')).toBe(false);
    closeTaskBoard();
    expect(url.searchParams.has('board')).toBe(false);
    expect(url.searchParams.get('keep')).toBe('yes');
  });
});
