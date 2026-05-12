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

interface HoverAnchor {
  /** Top of the hovered row in viewport coords. */
  top: number;
  /** Bottom of the hovered row in viewport coords. */
  bottom: number;
  /** Right edge of the rail — where the panel anchors its left side. */
  railRight: number;
}

interface HoverState {
  sessionId: string;
  anchor: HoverAnchor;
}

interface HoverContextValue {
  state: HoverState | null;
  /** Show the preview after a brief delay so flicking past rows doesn't
   *  pop a panel for every one. */
  onRowEnter: (sessionId: string, anchor: HoverAnchor) => void;
  /** Schedule a close — cancellable if the cursor re-enters the row or
   *  moves onto the panel. */
  onRowLeave: () => void;
  /** Cancel any pending close — used by the panel itself when the user
   *  moves over it. */
  cancelClose: () => void;
  /** Hard-close the preview (e.g. clicked into a session, scrolled). */
  closeNow: () => void;
}

const HoverContext = createContext<HoverContextValue | null>(null);

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 150;

export function SessionHoverProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HoverState | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const onRowEnter = useCallback(
    (sessionId: string, anchor: HoverAnchor) => {
      // Cancel any pending close — cursor came back.
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      // If a panel is already open, swap target immediately (no re-delay)
      // so dragging the cursor down a list of rows feels live.
      if (state) {
        setState({ sessionId, anchor });
        return;
      }
      if (openTimer.current) clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => {
        setState({ sessionId, anchor });
        openTimer.current = null;
      }, OPEN_DELAY_MS);
    },
    [state],
  );

  const onRowLeave = useCallback(() => {
    // Cancel any pending open — cursor moved on before delay elapsed.
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setState(null);
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeNow = useCallback(() => {
    clearTimers();
    setState(null);
  }, [clearTimers]);

  // Clear any pending timers if the provider unmounts mid-delay.
  useEffect(() => () => clearTimers(), [clearTimers]);

  const value = useMemo<HoverContextValue>(
    () => ({ state, onRowEnter, onRowLeave, cancelClose, closeNow }),
    [state, onRowEnter, onRowLeave, cancelClose, closeNow],
  );

  return <HoverContext.Provider value={value}>{children}</HoverContext.Provider>;
}

export function useSessionHover() {
  const ctx = useContext(HoverContext);
  if (!ctx) {
    throw new Error('useSessionHover must be used within a SessionHoverProvider');
  }
  return ctx;
}

/**
 * Wires a session row's hover events to the preview panel. Returns the
 * ref the row must spread + the mouseenter/leave handlers. Shared across
 * `SessionRow`, `StatusSessionRow`, and `SkinnySessionRow` so the same
 * panel can be triggered from any rail rendering.
 */
export function useSessionRowHover(sessionId: string) {
  const { onRowEnter, onRowLeave, closeNow } = useSessionHover();
  const rowRef = useRef<HTMLDivElement | null>(null);

  const onMouseEnter = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const rail = row.closest('aside');
    const railRight = rail?.getBoundingClientRect().right ?? rect.right;
    onRowEnter(sessionId, {
      top: rect.top,
      bottom: rect.bottom,
      railRight,
    });
  }, [onRowEnter, sessionId]);

  return { rowRef, onMouseEnter, onMouseLeave: onRowLeave, closeNow };
}
