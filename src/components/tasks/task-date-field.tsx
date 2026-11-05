'use client';

import { Calendar as CalendarIcon } from 'lucide-react';
import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseTypedDate } from '@/lib/date-input';
import { formatLocalDate, isPastDate, parseLocalDate, toDateOnly } from '@/lib/dates';
import { todayLocalDate } from '@/lib/deck/date';
import { cn } from '@/lib/utils';

const FULL_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

function describeDate(date: string) {
  const thisYear = date.startsWith(String(new Date().getFullYear()));
  return formatLocalDate(date, { weekday: 'short', month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
}

/** Clicks inside reach the row behind through React's portal bubbling, and a held touch would start dragging it. */
function keepFromRow(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The one way to set a task date: type it or pick it. `children` is the chip or
 * field that opens it. A picked day saves at once. Typed text saves on Enter or
 * on leaving, and Escape leaves everything as it was.
 */
export function TaskDatePicker({ label, value, onChange, children, open, onOpenChange }: {
  label: string; value: string | null | undefined; onChange: (date: string | null) => void; children: ReactElement;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Mounted per opening, so a new opening starts from the saved date. */}
      {isOpen && <DatePanel label={label} value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </Popover>
  );
}

function DatePanel({ label, value, onChange, onClose }: {
  label: string; value: string | null | undefined; onChange: (date: string | null) => void; onClose: () => void;
}) {
  const saved = toDateOnly(value);
  const initial = formatLocalDate(saved, FULL_DATE) ?? '';
  const [text, setText] = useState(initial);
  const [month, setMonth] = useState(() => parseLocalDate(saved) ?? new Date());
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  const edited = text !== initial;
  const empty = !text.trim();
  const picked = edited ? parseTypedDate(text) : saved;
  const unreadable = edited && !empty && !picked;

  const save = (next: string | null) => {
    if (settled.current) return;
    settled.current = true;
    if (next !== saved) onChange(next);
  };
  const finish = (next: string | null) => {
    save(next);
    onClose();
  };

  return (
    <PopoverContent
      align="start"
      className="w-auto p-2"
      data-cancel-on-escape=""
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        // On a phone the keyboard would cover the calendar, and tapping a day is the quick way there.
        if (window.matchMedia('(pointer: coarse)').matches) return;
        input.current?.focus();
        input.current?.select();
      }}
      onInteractOutside={() => {
        if (!edited || unreadable) return;
        save(empty ? null : picked);
      }}
    >
      <div onClick={keepFromRow} onTouchStart={keepFromRow} className="flex flex-col gap-2">
        <InputGroup className="h-8 rounded-md">
          <InputGroupInput
            ref={input}
            aria-label={label}
            aria-invalid={unreadable}
            autoComplete="off"
            placeholder="Type a date, like fri"
            value={text}
            className="h-8 px-2 md:text-xs"
            onChange={(event) => {
              setText(event.target.value);
              const next = parseTypedDate(event.target.value);
              if (next) setMonth(parseLocalDate(next)!);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (empty) finish(null);
              else if (picked) finish(picked);
            }}
          />
          {edited && !empty && (
            <InputGroupAddon align="inline-end" className="py-0 pr-2">
              <InputGroupText aria-live="polite" className={cn('whitespace-nowrap text-xs', unreadable && 'text-destructive')}>
                {unreadable ? 'Not a date' : describeDate(picked!)}
              </InputGroupText>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Calendar
          mode="single"
          required
          selected={parseLocalDate(picked) ?? undefined}
          month={month}
          onMonthChange={setMonth}
          onSelect={(day) => finish(todayLocalDate(day))}
          className="p-0"
        />
        {saved && (
          <button
            type="button"
            onClick={() => finish(null)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear date
          </button>
        )}
      </div>
    </PopoverContent>
  );
}

/** A task date as a labeled field, for the task page's properties. */
export function TaskDateField({ label, value, onChange, highlightOverdue = false }: {
  label: string; value: string | null; onChange: (date: string | null) => void; highlightOverdue?: boolean;
}) {
  const shown = formatLocalDate(value, FULL_DATE);
  return (
    <TaskDatePicker label={label} value={value} onChange={onChange}>
      <button
        type="button"
        aria-label={`${label}: ${shown ?? 'not set'}`}
        className={cn(
          'inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted',
          !shown && 'text-muted-foreground',
          highlightOverdue && isPastDate(value) && 'border-red-500/50 text-red-500',
        )}
      >
        <CalendarIcon size={12} />
        {shown ?? 'Set date'}
      </button>
    </TaskDatePicker>
  );
}
