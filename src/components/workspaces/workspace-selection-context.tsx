'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
  isSelected: (id: string) => boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * Holds the workspace-tree multi-select state so the rail header (which
 * owns the toggle + the Archive/Cancel toolbar) and the individual
 * `SessionRow`s (which render the checkboxes) can share one source of
 * truth without prop-drilling through `WorkspaceRow`.
 *
 * Scoped to the workspace nav only — the needs-review duplicate rows and
 * the by-status / history lenses never see this provider, so selection
 * stays a property of the canonical tree.
 */
export function WorkspaceSelectionProvider({ children }: { children: ReactNode }) {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const enter = useCallback(() => setSelecting(true), []);

  const exit = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    // Functional updater — the set is rebuilt from the latest state, so
    // rapid clicks never read a stale snapshot through the closure.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const value = useMemo<SelectionContextValue>(
    () => ({
      selecting,
      selectedIds,
      count: selectedIds.size,
      enter,
      exit,
      toggle,
      isSelected,
    }),
    [selecting, selectedIds, enter, exit, toggle, isSelected],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * Reads the workspace selection state. Returns `null` when rendered
 * outside the provider (e.g. a `SessionRow` on the by-status surface) so
 * callers can no-op rather than crash.
 */
export function useWorkspaceSelection(): SelectionContextValue | null {
  return useContext(SelectionContext);
}
