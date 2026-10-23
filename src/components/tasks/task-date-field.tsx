'use client';

import { useEffect, useRef } from 'react';
import { dateInputToStored, calendarDaysUntil } from '@/lib/dates';
import { cn } from '@/lib/utils';

/** Calendar dates commit once, and Escape restores the saved value. */
export function TaskDateField({ label, value, onChange, highlightOverdue = false }: {
  label: string; value: string | null; onChange: (date: string | null) => void; highlightOverdue?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const saved = value?.slice(0, 10) ?? '';
  useEffect(() => { if (input.current && document.activeElement !== input.current) input.current.value = saved; }, [saved]);
  return <input ref={input} type="date" aria-label={label} data-cancel-on-escape="" defaultValue={saved}
    className={cn('w-fit rounded-md border border-border bg-transparent px-2 py-1 text-xs', highlightOverdue && (calendarDaysUntil(value) ?? 0) < 0 && 'border-red-500/50 text-red-500')}
    onFocus={() => { cancelled.current = false; }}
    onBlur={event => {
      if (cancelled.current) { event.currentTarget.value = saved; cancelled.current = false; return; }
      const next = dateInputToStored(event.currentTarget.value);
      if (next !== (saved || null)) onChange(next);
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.value = saved; event.currentTarget.blur(); }
    }} />;
}
