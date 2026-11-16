'use client';

import { Check, Repeat } from 'lucide-react';
import { useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import {
  RECURRENCE_PRESETS,
  describeRecurrence,
  parseRecurrence,
  recurrenceHasDetail,
  recurrenceLabel,
  recurrenceValue,
} from '@/lib/tasks/recurrence';
import { cn } from '@/lib/utils';

/** Clicks inside reach the row behind through React's portal bubbling, and a held touch would start dragging it. */
function keepFromRow(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The one way to set how a task repeats: type it ("every 2 weeks", "3d") or
 * pick a common one. `children` is the chip or field that opens it. A pick
 * saves at once. Typed text saves on Enter or on leaving, and Escape leaves
 * everything as it was, like the date picker beside it.
 */
export function TaskRecurrencePicker({ value, onChange, children, open, onOpenChange }: {
  value: string | null | undefined; onChange: (recurrence: string | null) => void; children: ReactElement;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/* Mounted per opening, so a new opening starts from the saved repeat. */}
      {isOpen && <RecurrencePanel value={value ?? null} onChange={onChange} onClose={() => setOpen(false)} />}
    </Popover>
  );
}

function RecurrencePanel({ value, onChange, onClose }: {
  value: string | null; onChange: (recurrence: string | null) => void; onClose: () => void;
}) {
  const savedCadence = parseRecurrence(value);
  const saved = savedCadence ? recurrenceValue(savedCadence) : null;
  const initial = recurrenceLabel(value) ?? '';
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  const edited = text !== initial;
  const empty = !text.trim();
  const typed = edited && !empty ? parseRecurrence(text) : null;
  const unreadable = edited && !empty && !typed;

  // The same cadence is no change, so saved wording ("Yearly, only if
  // applicable") survives picking what it already says.
  const save = (next: string | null) => {
    if (settled.current) return;
    settled.current = true;
    if (next === null ? value !== null : next !== saved) onChange(next);
  };
  const finish = (next: string | null) => {
    save(next);
    onClose();
  };

  return (
    <PopoverContent
      align="start"
      className="w-60 p-2"
      data-cancel-on-escape=""
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        // On a phone the keyboard would cover the choices, and tapping one is the quick way there.
        if (window.matchMedia('(pointer: coarse)').matches) return;
        input.current?.focus();
        input.current?.select();
      }}
      onInteractOutside={() => {
        if (!edited || unreadable) return;
        save(typed ? recurrenceValue(typed) : null);
      }}
    >
      <div onClick={keepFromRow} onTouchStart={keepFromRow} className="flex flex-col gap-1">
        <InputGroup className="h-8 rounded-md">
          <InputGroupInput
            ref={input}
            aria-label="Repeat"
            aria-invalid={unreadable}
            autoComplete="off"
            placeholder="Type one, like every 2 weeks"
            value={text}
            className="h-8 px-2 md:text-xs"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (empty) finish(null);
              else if (typed) finish(recurrenceValue(typed));
              else if (!edited) onClose();
            }}
          />
          {edited && !empty && (
            <InputGroupAddon align="inline-end" className="py-0 pr-2">
              <InputGroupText aria-live="polite" className={cn('whitespace-nowrap text-xs', unreadable && 'text-destructive')}>
                {typed ? describeRecurrence(typed) : 'Not a repeat'}
              </InputGroupText>
            </InputGroupAddon>
          )}
        </InputGroup>
        {recurrenceHasDetail(value) && (
          <p className="px-2 pt-1 text-[11px] leading-snug text-muted-foreground">Saved as &ldquo;{value}&rdquo;</p>
        )}
        <div className="mt-1 flex flex-col">
          {RECURRENCE_PRESETS.map((preset) => {
            const presetValue = recurrenceValue(preset);
            const current = presetValue === saved;
            return (
              <button
                key={presetValue}
                type="button"
                aria-pressed={current}
                onClick={() => finish(presetValue)}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
              >
                {describeRecurrence(preset)}
                {current && <Check size={12} className="text-primary" aria-hidden />}
              </button>
            );
          })}
        </div>
        {value && (
          <button
            type="button"
            onClick={() => finish(null)}
            className="mt-1 rounded-md border-t border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Don&rsquo;t repeat
          </button>
        )}
      </div>
    </PopoverContent>
  );
}

/** How a task repeats, as a labeled field for the task page's properties. */
export function TaskRecurrenceField({ value, onChange }: {
  value: string | null; onChange: (recurrence: string | null) => void;
}) {
  const label = recurrenceLabel(value);
  const button = (
    <button
      type="button"
      aria-label={`Repeat: ${label ?? 'Never'}`}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted',
        !label && 'text-muted-foreground',
      )}
    >
      <Repeat size={12} />
      {label ?? 'Never'}
    </button>
  );
  return (
    <TaskRecurrencePicker value={value} onChange={onChange}>
      {recurrenceHasDetail(value) ? <Tip label={`Saved as “${value}”`}>{button}</Tip> : button}
    </TaskRecurrencePicker>
  );
}
