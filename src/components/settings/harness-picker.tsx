import { HarnessIcon } from './harness-connection-ui';
import { DEFAULT_HARNESS, harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import { cn } from '@/lib/utils';

/** Registry-ordered choices shared by onboarding and settings. */
export function HarnessPicker({
  harnesses,
  value,
  onChange,
  defaultHarness,
}: {
  harnesses: readonly { id: HarnessId; hint?: string }[];
  value: HarnessId;
  onChange: (id: HarnessId) => void;
  defaultHarness?: HarnessId;
}) {
  return (
    <div className="@container">
      <div data-harness-picker className="grid grid-cols-1 gap-2 @min-[400px]:grid-cols-2">
        {harnesses.map(({ id, hint }) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            data-harness-card={id}
            className={cn(
              'flex min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors first:col-span-full last:[&:nth-child(even)]:col-span-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              value === id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
            )}
          >
            <HarnessIcon id={id} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{harnessDefinition(id).name}</span>
                {id === DEFAULT_HARNESS && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Recommended</span>
                )}
                {id === defaultHarness && (
                  <span className="text-[10px] font-medium text-muted-foreground">Default</span>
                )}
              </span>
              <span className="block text-xs text-muted-foreground">{hint ?? harnessDefinition(id).description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
