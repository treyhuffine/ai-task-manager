'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';

interface SelectionContextValue {
  /** True while the user is in multi-select mode (driven by the rail
   *  header's archive toggle). */
  selecting: boolean;
  /** Session ids currently checked for bulk archive. */
  selectedIds: Set<string>;
  /** Convenience: number of checked rows. */
  count: number;
  /** Enter selection mode (does not clear an existing selection). */
  enter: () => void;
  /** Leave selection mode AND drop every selection — this is the Cancel
   *  affordance and the post-archive reset. */
  exit: () => void;
  /** Flip one session's checked state. */
  toggle: (id: string) => void;
  /**
   * Shift-click: flip `id`, and give every row between it and the row last
   * flipped the same state. `order` is the rows as they show, top to bottom.
   * With no earlier row in `order`, the same as `toggle`.
   */
  toggleRange: (id: string, order: readonly string[]) => void;
  /** Check or uncheck many at once (a fold's Select all). */
  setMany: (ids: readonly string[], checked: boolean) => void;
  isSelected: (id: string) => boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Holds the rail's multi-select state for bulk archive, so the rail header
 * (which owns the toggle + the Archive/Cancel toolbar) and the rows (which
 * render the checkboxes) share one source of truth without prop-drilling.
 *
 * The rail provides it around the list header and the list. While selecting,
 * the list is Recent's, whatever tab is open (`RailListBody`). Rows that would
 * duplicate a selectable row (Pinned) sit inside a
 * `WorkspaceSelectionBoundary`, so a session never shows two checkboxes.
 *
 * Esc leaves selection while focus is in the rail's list (`data-rail-list`)
 * or nowhere in particular, before a flyout around the list would take it to
 * close. A dialog or menu above the rail keeps its own Esc.
 */
export function WorkspaceSelectionProvider({ children }: { children: ReactNode }) {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // The row a Shift-click ranges from: the one last flipped.
  const anchor = useRef<string | null>(null);

  const enter = useCallback(() => setSelecting(true), []);

  const exit = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
    anchor.current = null;
  }, []);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    // Functional updater — the set is rebuilt from the latest state, so
    // rapid clicks never read a stale snapshot through the closure.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRange = useCallback((id: string, order: readonly string[]) => {
    const from = anchor.current ? order.indexOf(anchor.current) : -1;
    const to = order.indexOf(id);
    anchor.current = id;
    setSelectedIds((prev) => {
      const checked = !prev.has(id);
      const range = from < 0 || to < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
      const next = new Set(prev);
      for (const r of range) {
        if (checked) next.add(r);
        else next.delete(r);
      }
      return next;
    });
  }, []);

  const setMany = useCallback((ids: readonly string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !matchesHotkey(e, HOTKEYS.cancelSelection)) return;
      const target = e.target;
      const inList = target === document.body || (target instanceof Element && !!target.closest('[data-rail-list]'));
      if (!inList) return;
      e.preventDefault();
      exit();
    };
    // Capture, so it runs before the Agents flyout's own Esc closes the list.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selecting, exit]);

  const value = useMemo<SelectionContextValue>(
    () => ({
      selecting,
      selectedIds,
      count: selectedIds.size,
      enter,
      exit,
      toggle,
      toggleRange,
      setMany,
      isSelected,
    }),
    [selecting, selectedIds, enter, exit, toggle, toggleRange, setMany, isSelected],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * Reads the workspace selection state. Returns `null` when rendered
 * outside the provider (e.g. a `SessionRow` in Pinned) so
 * callers can no-op rather than crash.
 */
export function useWorkspaceSelection(): SelectionContextValue | null {
  return useContext(SelectionContext);
}

/** Turns selection off for a subtree whose rows duplicate selectable ones. */
export function WorkspaceSelectionBoundary({ children }: { children: ReactNode }) {
  return <SelectionContext.Provider value={null}>{children}</SelectionContext.Provider>;
}

/**
 * One row's part in the selection, shared by the rail's rows. `selectable`
 * while selecting (and `enabled`), when the row's click should `toggle`
 * rather than open. A Shift-click ranges over `order`, the list's rows as
 * they show, when the list passes it.
 */
export function useRowSelection(id: string, { enabled = true, order }: { enabled?: boolean; order?: readonly string[] } = {}) {
  const selection = useWorkspaceSelection();
  const selectable = enabled && !!selection?.selecting;
  const selected = selectable && !!selection?.isSelected(id);
  const toggle = (e?: { shiftKey?: boolean }) => {
    if (!selection) return;
    if (e?.shiftKey && order) selection.toggleRange(id, order);
    else selection.toggle(id);
  };
  return { selectable, selected, toggle };
}

/**
 * The checkbox a selectable row shows in place of its status. Pointer-events
 * none: the row's click is the one source of toggle truth, so a click
 * anywhere on the row (box included) flips selection exactly once.
 */
export function SelectionCheck({ checked }: { checked: boolean }) {
  return <Checkbox checked={checked} tabIndex={-1} aria-hidden className="pointer-events-none size-3.5" />;
}
