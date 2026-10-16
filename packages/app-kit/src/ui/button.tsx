import type { ButtonHTMLAttributes, ReactNode, Ref, MouseEvent } from "react";
import { cx } from "./util.js";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "link" | "danger" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows progress and ignores clicks while keeping focus on the button. */
  busy?: boolean;
  /** Announced while busy. Defaults to "Working". */
  busyLabel?: string;
  /** Stretch to the container width. */
  block?: boolean;
  type?: "button" | "submit" | "reset";
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

/**
 * A button. Busy and disabled states use `aria-disabled`, so a focused button
 * keeps focus while work runs. Defaults to `type="button"`.
 */
export function Button({ variant = "secondary", size = "md", busy = false, busyLabel = "Working", block, type = "button", className, disabled, onClick, children, ref, ...rest }: ButtonProps) {
  const inactive = Boolean(disabled || busy);
  return (
    <button
      ref={ref}
      type={type}
      className={cx("ri-button", `ri-button--${variant}`, size !== "md" && `ri-button--${size}`, block && "ri-button--block", className)}
      aria-disabled={inactive || undefined}
      aria-busy={busy || undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inactive) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {busy && <span className="ri-button__spinner" aria-hidden="true" />}
      {children}
      {busy && <span className="ri-sr-only">, {busyLabel}</span>}
    </button>
  );
}

/** A wrapping row of buttons. */
export function ButtonRow({ children, align = "start", className, label }: { children?: ReactNode; align?: "start" | "end" | "between"; className?: string; label?: string }) {
  return (
    <div className={cx("ri-button-row", align !== "start" && `ri-button-row--${align}`, className)} role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
