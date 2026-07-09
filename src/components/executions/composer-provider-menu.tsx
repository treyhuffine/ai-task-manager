'use client';

import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sparkles, MessageSquarePlus, Loader2 } from 'lucide-react';
import { findProvider, type ProviderId } from '@/lib/agent-options';
import { useAgentModels } from '@/hooks/use-agent-models';
import { ModelList, type ModelSelection } from '@/components/settings/model-list';
import { ProviderIcon } from '@/components/settings/agent-connection-ui';
import { cn } from '@/lib/utils';

interface ComposerProviderMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This session's provider (composer harness, mapped to provider vocab). */
  currentProvider: ProviderId;
  /** This session's pinned model id, or null = harness default. */
  model: string | null;
  fallbackLabel: string;
  /** Pick a model within the *current* provider — updates this session. */
  onSelectModel: (id: string | null) => void;
  /** Switch to a *different* provider — starts a fresh chat on it. */
  onSwitchProvider: (next: { harness: ProviderId; model: string | null }) => void;
  /** A provider switch (new chat) is in flight. */
  switching?: boolean;
  disabled?: boolean;
}

/**
 * The composer's model control: a flat, all-providers-at-once list (see
 * ModelList). Picking a model in the *current* provider pins it on this
 * session immediately. Picking a model in a *different* provider can't change
 * this session mid-stream (the agents can't resume each other), so the list is
 * REPLACED by a focused confirm (provider icon + explanation + Start new chat /
 * Back) that starts a **fresh chat** on that provider — an unmissable takeover
 * rather than a CTA appended below a scrolling list. Other-provider groups are
 * flagged "new chat" in the list so the switch is expected before the click.
 * Disconnected providers carry the same login/check panel as onboarding and
 * their rows are disabled.
 */
export function ComposerProviderMenu({
  open,
  onOpenChange,
  currentProvider,
  model,
  fallbackLabel,
  onSelectModel,
  onSwitchProvider,
  switching,
  disabled,
}: ComposerProviderMenuProps) {
  const [pending, setPending] = useState<ModelSelection | null>(null);

  const reset = (next: boolean) => {
    if (!next) setPending(null);
    onOpenChange(next);
  };

  const handlePick = (harness: ProviderId, m: string | null) => {
    if (harness === currentProvider) {
      onSelectModel(m);
      reset(false);
    } else {
      // Cross-provider: stage it; confirming starts a fresh chat.
      setPending({ harness, model: m });
    }
  };

  const selected: ModelSelection = pending ?? { harness: currentProvider, model };
  const pendingProvider = pending ? findProvider(pending.harness) : null;
  const { models: pendingModels } = useAgentModels(pending?.harness);
  const pendingModelLabel =
    pending && pending.model
      ? pendingModels.find((m) => m.id === pending.model)?.label ?? pending.model
      : null;

  return (
    <Popover open={open} onOpenChange={reset}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={model ? `Model: ${model}` : 'Use harness default'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
            'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            'disabled:opacity-50',
          )}
        >
          <Sparkles size={11} className="text-primary/70" />
          <span>{fallbackLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-2">
        {pending && pendingProvider ? (
          // Cross-provider pick can't change this session mid-stream, so the
          // list is REPLACED by a focused confirm — there's nothing else to
          // click, so the action can't be missed or scrolled past (the old
          // design appended this below the list, often below the fold).
          <div className="p-1">
            <div className="flex flex-col items-center gap-2 px-2 pb-3 pt-2 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <ProviderIcon id={pending.harness} size={20} />
              </span>
              <span className="text-[13px] font-semibold text-foreground">
                Switch to {pendingProvider.name}?
              </span>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Starts a fresh chat on {pendingProvider.name}
                {pendingModelLabel ? ` with ${pendingModelLabel}` : ''}. Your current thread is saved
                in history.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onSwitchProvider(pending);
                  reset(false);
                }}
                disabled={switching}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {switching ? <Loader2 size={13} className="animate-spin" /> : <MessageSquarePlus size={13} />}
                Start new chat
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={switching}
                className="rounded-md border border-border px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="max-h-[440px] overflow-y-auto">
            <ModelList selected={selected} onPick={handlePick} switchHintProvider={currentProvider} />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
