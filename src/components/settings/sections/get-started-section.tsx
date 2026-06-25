'use client';

import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setSettingsSection } from '@/components/settings/settings-store';
import type { SetupChecklist } from '@/components/settings/use-setup-checklist';

/**
 * The "Get started" checklist. Each item is derived-done, actionable (jump to
 * its tab), or dismissed (button → inline "do it later" guidance, with undo).
 * The whole tab auto-hides once every item is done-or-dismissed (handled by the
 * modal), so this pane only renders while there's still something to nudge.
 */
export function GetStartedSection({ checklist }: { checklist: SetupChecklist }) {
  const { items, doneCount, total, dismiss, restore } = checklist;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-[12.5px] leading-relaxed text-foreground/90">
          A few quick steps to get the most out of your workspace. Do what&apos;s useful, skip what isn&apos;t. This
          disappears once you&apos;re set.
        </p>
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {doneCount}/{total} done
          </span>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3',
              item.done ? 'border-border/60 bg-card/30' : 'border-border bg-background',
            )}
          >
            {item.done ? (
              <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={16} className={cn('shrink-0', item.dismissed ? 'text-muted-foreground/40' : 'text-muted-foreground')} />
            )}

            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  item.done ? 'text-muted-foreground line-through' : item.dismissed ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {item.label}
              </p>
              {item.dismissed && !item.done && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/80">{item.hint}</p>
              )}
            </div>

            {/* Right side: done = nothing; pending = Set up + Skip; dismissed = Undo. */}
            {item.done ? null : item.dismissed ? (
              <button
                type="button"
                onClick={() => restore(item.id)}
                className="shrink-0 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                Undo
              </button>
            ) : (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSettingsSection(item.section)}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90"
                >
                  Set up
                  <ArrowRight size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Skip
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
