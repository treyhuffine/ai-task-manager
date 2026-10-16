import type { ReactNode } from "react";
import { Button } from "./button.js";
import { DangerIcon, InfoIcon, NeutralIcon, SuccessIcon, WarningIcon } from "./icons.js";
import { cx } from "./util.js";

export type Tone = "neutral" | "warning" | "danger" | "success" | "info";

/** The shape for a tone, so color is never the only signal. */
export function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  switch (tone) {
    case "warning": return <WarningIcon className={className} />;
    case "danger": return <DangerIcon className={className} />;
    case "success": return <SuccessIcon className={className} />;
    case "info": return <InfoIcon className={className} />;
    default: return <NeutralIcon className={className} />;
  }
}

/** A short state label with a shape marker, such as "Confirmed" or "Needs review". */
export function StatusLabel({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("ri-status", `ri-status--${tone}`, className)}>
      <ToneIcon tone={tone} className="ri-status__marker" />
      <span>{children}</span>
    </span>
  );
}

export interface NoticeProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Announce the notice when it appears. Use for notices caused by the person's action. */
  live?: boolean;
  className?: string;
}
/** An attention banner such as "One booking needs a look", with an optional action. */
export function Notice({ tone = "warning", title, children, action, live, className }: NoticeProps) {
  return (
    <div className={cx("ri-notice", `ri-notice--${tone}`, className)} role={live ? (tone === "danger" ? "alert" : "status") : undefined}>
      <div className="ri-notice__content">
        <ToneIcon tone={tone} className="ri-notice__marker" />
        <div>
          {title && <p className="ri-notice__title">{title}</p>}
          {children && <div className="ri-notice__body">{children}</div>}
        </div>
      </div>
      {action && <div className="ri-button-row">{action}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Smaller spacing for an empty panel or list inside a page. */
  compact?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}
/** What is missing and the one useful next action. */
export function EmptyState({ title, children, action, compact, headingLevel = 2, className }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cx("ri-empty", compact && "ri-empty--compact", className)}>
      <Heading className="ri-empty__title">{title}</Heading>
      {children && <div className="ri-empty__body">{children}</div>}
      {action && <div className="ri-empty__actions">{action}</div>}
    </div>
  );
}

/** A loading placeholder that keeps layout calm. The label is visible and announced. */
export function LoadingState({ label = "Loading", rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div className={cx("ri-loading", className)} role="status" aria-busy="true" aria-live="polite">
      <p className="ri-loading__label">{label}</p>
      <div aria-hidden="true">
        {Array.from({ length: Math.max(1, Math.min(rows, 12)) }, (_, index) => (
          <div className="ri-skeleton" key={index}>
            <span className="ri-skeleton__line" />
            <span className="ri-skeleton__line" />
            <span className="ri-skeleton__line" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A failure with its reason and a retry. */
export function ErrorState({ message, title, onRetry, retryLabel = "Try again", busy, className }: { message: ReactNode; title?: ReactNode; onRetry?: () => void; retryLabel?: string; busy?: boolean; className?: string }) {
  return (
    <div className={cx("ri-error", className)} role="alert">
      <div className="ri-error__message">
        <DangerIcon className="ri-error__marker" />
        <div>
          {title && <p className="ri-notice__title">{title}</p>}
          <p>{message}</p>
        </div>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry} busy={busy}>{retryLabel}</Button>}
    </div>
  );
}

/** A one-line failure under a control or inside a dialog. */
export function InlineError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p className="ri-inline-error" role="alert" id={id}>
      <DangerIcon />
      <span>{children}</span>
    </p>
  );
}
