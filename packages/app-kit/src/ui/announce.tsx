/**
 * Polite status announcements such as "Saved" or "Moved to Applied". Screen
 * readers hear them through a visually hidden live region. Sighted people see
 * the same words briefly in a toast, so the status is never audio-only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface AnnounceOptions {
  /** Show the message in a short toast as well. Defaults to true. */
  visual?: boolean;
  /** Use an assertive announcement for failures that block work. */
  assertive?: boolean;
}
export type Announce = (message: string, options?: AnnounceOptions) => void;

const AnnounceContext = createContext<Announce | null>(null);

/** Fallback when no `LiveRegion` is mounted: a hidden region on the body. */
function bodyAnnounce(message: string, options: AnnounceOptions = {}) {
  if (typeof document === "undefined") return;
  const id = options.assertive ? "ri-live-assertive" : "ri-live-polite";
  let region = document.getElementById(id);
  if (!region) {
    region = document.createElement("div");
    region.id = id;
    region.className = "ri-sr-only";
    region.setAttribute("role", options.assertive ? "alert" : "status");
    region.setAttribute("aria-live", options.assertive ? "assertive" : "polite");
    document.body.append(region);
  }
  region.textContent = "";
  const target = region;
  setTimeout(() => {
    target.textContent = message;
  }, 50);
}

/** Announce a short status message. Works inside or outside a `LiveRegion`. */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext) ?? bodyAnnounce;
}

/**
 * Provides `useAnnounce()` to its children and renders the live regions and
 * toast. `RiAppProvider` includes one, so most apps never mount it directly.
 */
export function LiveRegion({ children, toastMs = 3500 }: { children?: ReactNode; toastMs?: number }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const counter = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const announce = useCallback<Announce>((message, options = {}) => {
    const set = options.assertive ? setAssertive : setPolite;
    // Clearing first lets the same words be announced twice in a row.
    set("");
    timers.current.push(setTimeout(() => set(message), 50));
    if (options.visual !== false) {
      const key = ++counter.current;
      setToast({ message, key });
      timers.current.push(
        setTimeout(() => setToast((current) => (current?.key === key ? null : current)), toastMs),
      );
    }
    if (timers.current.length > 20) timers.current = timers.current.slice(-10);
  }, [toastMs]);
  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div className="ri-sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="ri-sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
      {toast && (
        <div className="ri-toast-region" aria-hidden="true">
          <div className="ri-toast" key={toast.key}>{toast.message}</div>
        </div>
      )}
    </AnnounceContext.Provider>
  );
}
