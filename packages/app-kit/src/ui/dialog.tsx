import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CloseIcon } from "./icons.js";
import { useAppLayout } from "./layout.js";
import { cx, focusableWithin } from "./util.js";

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  /** Actions at the foot, usually Cancel and one primary action. */
  footer?: ReactNode;
  /** Wider dialog for comparisons. */
  wide?: boolean;
  /** Ignore Escape and the close button while work runs. */
  busy?: boolean;
  closeLabel?: string;
  /** The element to focus first. Defaults to the first field or button in the body, then the close button. */
  initialFocusRef?: { current: HTMLElement | null };
  className?: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A modal dialog on the native `<dialog>` element. It is labelled by its
 * title, traps Tab inside, closes on Escape, returns focus to the element that
 * opened it, scrolls its body, and fills the frame at narrow widths.
 */
export function Dialog({ open, title, description, onClose, children, footer, wide, busy, closeLabel = "Close dialog", initialFocusRef, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const layout = useAppLayout();
  // The native close and cancel listeners read the latest props through refs,
  // kept current after each render so the listeners never need re-adding.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useIsomorphicLayoutEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  // Refs survive StrictMode's repeated effects, so the opener is captured once per opening.
  const wasOpen = useRef(false);
  useIsomorphicLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    if (!wasOpen.current) {
      wasOpen.current = true;
      const active = document.activeElement;
      restore.current = active instanceof HTMLElement && active !== document.body && !dialog.contains(active) ? active : null;
    }
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const preferred = initialFocusRef?.current;
    const fields = bodyRef.current ? focusableWithin(bodyRef.current) : [];
    const first = preferred ?? fields.find((element) => element.matches("input, select, textarea")) ?? fields[0] ?? closeRef.current;
    first?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);
  const restoreFocus = () => {
    const target = restore.current;
    restore.current = null;
    wasOpen.current = false;
    if (target?.isConnected) target.focus({ preventScroll: true });
  };
  // Return focus to the opener once the dialog is gone.
  useIsomorphicLayoutEffect(() => {
    if (!open && wasOpen.current) restoreFocus();
  }, [open]);
  useEffect(() => () => {
    if (wasOpen.current && restore.current) restoreFocus();
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    // Browsers may close a modal dialog on their own after repeated Escape presses.
    // Keep React in charge: report the close, and reopen if the owner keeps it open.
    const onNativeClose = () => {
      // A close event from an earlier close is stale once the dialog has reopened.
      if (!dialog.isConnected || dialog.open) return;
      if (busyRef.current) {
        if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
        return;
      }
      onCloseRef.current();
    };
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!busyRef.current) onCloseRef.current();
    };
    dialog.addEventListener("close", onNativeClose);
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("close", onNativeClose);
      dialog.removeEventListener("cancel", onCancel);
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;
    const elements = focusableWithin(ref.current);
    if (!elements.length) {
      event.preventDefault();
      return;
    }
    const first = elements[0], last = elements[elements.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={cx("ri-dialog", wide && "ri-dialog--wide", layout === "narrow" && "ri-dialog--full", className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onKeyDown={onKeyDown}
    >
      <div className="ri-dialog__head">
        <div>
          <h2 id={titleId} className="ri-dialog__title">{title}</h2>
          {description && <p id={descriptionId} className="ri-dialog__description">{description}</p>}
        </div>
        <button ref={closeRef} type="button" className="ri-icon-button" aria-label={closeLabel} aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
          <CloseIcon />
        </button>
      </div>
      <div ref={bodyRef} className="ri-dialog__body">{children}</div>
      {footer && <div className="ri-dialog__foot">{footer}</div>}
    </dialog>
  );
}
