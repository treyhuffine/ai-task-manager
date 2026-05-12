'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface BucketSectionProps {
  id: string;
  label: string;
  count: number;
  /** Color class for the header accent — drives label color and the
   *  count chip. */
  accentClass?: string;
  /** Stronger accent for the count chip background; falls back to the
   *  default muted chip when omitted. */
  countBgClass?: string;
  /** Icon element rendered before the label. */
  icon?: ReactNode;
  /** Hide the section entirely when no rows. Default true. */
  hideWhenEmpty?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

const STORAGE_PREFIX = 'flow.rail.bucket.';

/**
 * Collapsible bucket header + body. The header carries more visual
 * weight than a plain label — colored chevron + icon + accent-tinted
 * label + a count chip — so users can scan the rail and lock onto
 * the right bucket without reading every row.
 *
 * Open/closed state persists per bucket id in localStorage so the
 * rail remembers the user's last folding pattern across reloads.
 */
export function BucketSection({
  id,
  label,
  count,
  accentClass = 'text-muted-foreground',
  countBgClass,
  icon,
  hideWhenEmpty = true,
  defaultOpen = true,
  children,
}: BucketSectionProps) {
  const storageKey = `${STORAGE_PREFIX}${id}`;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored !== null) setOpen(stored === '1');
  }, [storageKey]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      }
      return next;
    });
  };

  if (hideWhenEmpty && count === 0) return null;

  return (
    <div className="px-1 pt-2 pb-1 first:pt-1">
      <button
        onClick={toggle}
        className={cn(
          'w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md transition-colors',
          'hover:bg-muted/40',
        )}
        aria-expanded={open}
      >
        <ChevronRight
          size={12}
          className={cn(
            'transition-transform shrink-0',
            accentClass,
            open && 'rotate-90',
          )}
        />
        {icon && (
          <span className="flex items-center justify-center shrink-0">
            {icon}
          </span>
        )}
        <span className={cn(
          'flex-1 text-left text-[10.5px] font-bold uppercase tracking-[0.12em]',
          accentClass,
        )}>
          {label}
        </span>
        <span className={cn(
          'inline-flex items-center justify-center min-w-[18px] h-[16px] px-1.5 rounded-full',
          'text-[9.5px] font-bold font-mono tabular-nums',
          countBgClass ?? 'bg-muted/70 text-muted-foreground',
        )}>
          {count}
        </span>
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">{children}</div>
      )}
    </div>
  );
}
