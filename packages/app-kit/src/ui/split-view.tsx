import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./button.js";
import { ChevronLeftIcon, CloseIcon } from "./icons.js";
import { useAppLayout, useElementWidth } from "./layout.js";
import { cx, isTypingTarget } from "./util.js";

type SplitMode = "split" | "single";
const SplitContext = createContext<{ mode: SplitMode; inSplit: boolean }>({ mode: "split", inSplit: false });
/** Whether the nearest `SplitView` shows list and detail side by side. */
export function useSplitMode(): SplitMode {
  return useContext(SplitContext).mode;
}

export interface SplitViewProps {
  /** The list, board or table. Stays mounted while a narrow detail screen is open, so its state survives Back. */
  list: ReactNode;
  /** The selected record, usually an `Inspector`. */
  detail?: ReactNode;
  /** Whether a record is open. The caller owns selection, filters and this flag. */
  detailOpen: boolean;
  /** Close the detail. Called by Back and by Escape. */
  onBack(): void;
  /** Back button text that names the destination, such as "Back to opportunities". */
  backLabel: string;
  /** Accessible name for the detail region, such as the record title. */
  detailLabel?: string;
  /** Shown in the inspector column at wide widths when nothing is open. */
  emptyDetail?: ReactNode;
  /** Narrowest own width that may show two columns. Defaults to 880 px. */
  minSplitWidth?: number;
  className?: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * List plus inspector at wide widths. At medium and narrow widths, or when
 * its own width is too tight, an open record becomes a dedicated screen with
 * a Back button. The list stays mounted but hidden so filters, scroll and
 * the selected row return unchanged, and focus goes back to where it was.
 * Never three columns.
 */
export function SplitView({ list, detail, detailOpen, onBack, backLabel, detailLabel, emptyDetail, minSplitWidth = 880, className }: SplitViewProps) {
  const layout = useAppLayout();
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const mode: SplitMode = layout === "wide" && (width === null || width >= minSplitWidth) ? "split" : "single";
  const single = mode === "single";
  const detailRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnScroll = useRef<number | null>(null);
  const wasOpen = useRef(false);
  const detailId = useId();
  const showDetailScreen = single && detailOpen;

  const initialized = useRef(false);
  useIsomorphicLayoutEffect(() => {
    // A record open on mount, such as a restored location, does not move focus or scroll.
    if (!initialized.current) {
      initialized.current = true;
      wasOpen.current = detailOpen;
      return;
    }
    if (detailOpen && !wasOpen.current) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && listRef.current?.contains(active) ? active : null;
      returnScroll.current = null;
      if (single) {
        // A dedicated detail screen starts at its top and takes focus.
        returnScroll.current = window.scrollY;
        const top = (ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 16;
        if (window.scrollY > top) window.scrollTo?.({ top: Math.max(0, top) });
        detailRef.current?.focus({ preventScroll: true });
      }
    } else if (!detailOpen && wasOpen.current) {
      if (returnScroll.current !== null) window.scrollTo?.({ top: returnScroll.current });
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (lost && returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
      returnScroll.current = null;
    }
    wasOpen.current = detailOpen;
  }, [detailOpen, single]);

  const onDetailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || isTypingTarget(event.target)) return;
    event.preventDefault();
    onBack();
  };
  const showInspectorColumn = !single && (detailOpen || emptyDetail);

  return (
    <SplitContext.Provider value={{ mode, inSplit: true }}>
      <div ref={ref} className={cx("ri-split", className)} data-mode={mode} data-detail={Boolean(showInspectorColumn)}>
        <div ref={listRef} className="ri-split__pane" hidden={showDetailScreen}>{list}</div>
        {showDetailScreen && (
          <section ref={detailRef} className="ri-split__detail" aria-label={detailLabel} tabIndex={-1} onKeyDown={onDetailKeyDown} id={detailId}>
            <Button variant="quiet" className="ri-split__back" onClick={onBack}>
              <ChevronLeftIcon />
              {backLabel}
            </Button>
            {detail}
          </section>
        )}
        {showInspectorColumn && (
          <section className="ri-split__detail" aria-label={detailOpen ? detailLabel : undefined} onKeyDown={detailOpen ? onDetailKeyDown : undefined}>
            {detailOpen ? detail : emptyDetail}
          </section>
        )}
      </div>
    </SplitContext.Provider>
  );
}

export interface InspectorProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  /** One line under the title. */
  subtitle?: ReactNode;
  /** Close the inspector. Hidden on a narrow detail screen, where Back does this. */
  onClose?: () => void;
  closeLabel?: string;
  /** Actions at the foot of the panel. */
  actions?: ReactNode;
  children?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}
/** The detail panel for a selected record. */
export function Inspector({ title, eyebrow, subtitle, onClose, closeLabel = "Close details", actions, children, headingLevel = 2, className }: InspectorProps) {
  const { mode, inSplit } = useContext(SplitContext);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = useId();
  const showClose = onClose && !(inSplit && mode === "single");
  return (
    <article className={cx("ri-inspector", className)} aria-labelledby={headingId}>
      <div className="ri-inspector__head">
        <div className="ri-inspector__heading">
          {eyebrow && <p className="ri-eyebrow">{eyebrow}</p>}
          <Heading id={headingId} className="ri-inspector__title">{title}</Heading>
          {subtitle && <p className="ri-inspector__subtitle">{subtitle}</p>}
        </div>
        {showClose && (
          <button type="button" className="ri-icon-button" aria-label={closeLabel} onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </div>
      {children && <div className="ri-inspector__body">{children}</div>}
      {actions && <div className="ri-inspector__actions">{actions}</div>}
    </article>
  );
}
