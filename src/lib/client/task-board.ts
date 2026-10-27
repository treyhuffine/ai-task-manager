'use client';

import { useSyncExternalStore } from 'react';
import type { BucketId } from '@/lib/sessions/classification';

export type BoardView = 'activity' | 'tasks';
export const BOARD_VIEW_KEY = 'ri.board.view';
export interface BoardState { open: boolean; view: BoardView; focusBucket: BucketId | null; }
const initial: BoardState = { open: false, view: 'activity', focusBucket: null };
let state = initial;
const listeners = new Set<() => void>();
const buckets: readonly string[] = ['needsApproval', 'unread', 'working', 'waiting'];

/** Old task-board bookmarks keep their meaning. New links name the view. */
export function boardFromSearch(search: string): BoardState | null {
  const params = new URLSearchParams(search);
  if (!params.has('board')) return null;
  const view = params.get('board') === 'activity' ? 'activity' : 'tasks';
  const bucket = params.get('boardFocus');
  return { open: true, view, focusBucket: view === 'activity' && bucket && buckets.includes(bucket) ? bucket as BucketId : null };
}

function emit(next: BoardState) {
  state = next;
  for (const listener of listeners) listener();
}
function remember(view: BoardView) {
  try { window.localStorage.setItem(BOARD_VIEW_KEY, view); } catch { /* Browser preference is best effort. */ }
}
function remembered(): BoardView {
  try { return window.localStorage.getItem(BOARD_VIEW_KEY) === 'tasks' ? 'tasks' : 'activity'; } catch { return 'activity'; }
}
/** `board` and `boardFocus` are among the names an app's query never holds (`active-view.ts`). */
function writeUrl() {
  const url = new URL(window.location.href);
  if (state.open) url.searchParams.set('board', state.view);
  else url.searchParams.delete('board');
  if (state.open && state.focusBucket) url.searchParams.set('boardFocus', state.focusBucket);
  else url.searchParams.delete('boardFocus');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Rail and palette remember the last view. HUD expansion explicitly selects a bucket. */
export function openBoard(options: { view?: BoardView; focusBucket?: BucketId } = {}): void {
  const view = options.focusBucket ? 'activity' : options.view ?? remembered();
  remember(view);
  emit({ open: true, view, focusBucket: options.focusBucket ?? null });
  writeUrl();
}
export function clearBoardFocus(): void {
  if (!state.focusBucket) return;
  emit({ ...state, focusBucket: null });
  writeUrl();
}
/** Deliberate task-context entry, kept for existing callers. */
export function openTaskBoard(): void { openBoard({ view: 'tasks' }); }
export function closeTaskBoard(): void {
  if (!state.open) return;
  emit({ ...state, open: false, focusBucket: null });
  writeUrl();
}
export function syncBoardFromUrl(): void {
  const next = boardFromSearch(window.location.search);
  if (next) remember(next.view);
  if (next?.open === state.open && next?.view === state.view && next?.focusBucket === state.focusBucket) return;
  emit(next ?? { ...state, open: false, focusBucket: null });
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useBoardState(): BoardState { return useSyncExternalStore(subscribe, () => state, () => initial); }
export function useTaskBoardOpen(): boolean { return useBoardState().open; }
