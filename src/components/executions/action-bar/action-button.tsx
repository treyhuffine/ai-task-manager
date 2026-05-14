'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  /** Optional count badge (e.g. `(3)` for ahead-by-three). */
  count?: number;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  /** Visual variant — `primary` for the headline action, `secondary` for the rest. */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Tooltip / aria-label. */
  title?: string;
}

/**
 * Shared button used across the action bar. Keeps the spacing,
 * pending-spinner, and count-badge treatment identical for every action
 * so the bar reads as one coherent unit.
 */
export function ActionButton({
  icon,
  label,
  count,
  onClick,
  pending,
  disabled,
  variant = 'secondary',
  title,
}: ActionButtonProps) {
  const isDisabled = !!disabled || !!pending;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      title={title ?? label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary'
          ? 'border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90'
          : variant === 'ghost'
            ? 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            : 'border-border bg-background text-foreground/85 hover:bg-muted/40',
      )}
    >
      {pending ? <Loader2 size={11} className="animate-spin" /> : icon}
      <span className="truncate">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold tabular-nums text-muted-foreground bg-muted/60">
          {count}
        </span>
      )}
    </button>
  );
}
