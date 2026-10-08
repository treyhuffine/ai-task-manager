import { HarnessIcon } from './harness-connection-ui';
import { harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import { cn } from '@/lib/utils';

/**
 * Registry-ordered choices shared by onboarding and settings, one equal row
 * each: no harness is featured or recommended, and any number of them lines
 * up without an odd one left over. Name and description share a line when
 * there's room, and stack on a narrow panel.
 */
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
      <div data-harness-picker className="flex flex-col gap-1.5">
        {harnesses.map(({ id, hint }) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            data-harness-card={id}
            className={cn(
              'flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              value === id ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
            )}
          >
            <HarnessIcon id={id} className="size-[18px] shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 @min-[440px]:flex-row @min-[440px]:items-baseline @min-[440px]:gap-2.5">
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-medium">{harnessDefinition(id).name}</span>
                {id === defaultHarness && (
                  <span className="text-[10px] font-medium text-muted-foreground">Default</span>
                )}
              </span>
              <span className="min-w-0 text-xs text-muted-foreground">{hint ?? harnessDefinition(id).description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
