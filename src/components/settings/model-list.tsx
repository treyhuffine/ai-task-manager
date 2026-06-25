'use client';

import { Check } from 'lucide-react';
import { PROVIDERS, findProvider, modelsForProvider, type ProviderId } from '@/lib/agent-options';
import { useAgentConnection } from '@/hooks/use-agent-connection';
import { ProviderIcon, ConnectionBadge, ConnectionPanel } from './agent-connection-ui';
import { cn } from '@/lib/utils';

export interface ModelSelection {
  harness: ProviderId;
  model: string | null;
}

/**
 * Flat, all-providers-at-once model list (Cursor-style): every provider's
 * models visible simultaneously, grouped under provider headers, rather than
 * a two-level provider→model drill-down. Each group shows its live connection
 * state; a disconnected provider surfaces the login/check panel and its rows
 * are disabled until it's connected. Pure/controlled — the parent decides what
 * a pick means (set the default, or switch the session's provider).
 */
export function ModelList({
  selected,
  onPick,
  className,
}: {
  selected: ModelSelection;
  onPick: (harness: ProviderId, model: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {PROVIDERS.map((p) => (
        <ProviderGroup key={p.id} providerId={p.id} selected={selected} onPick={onPick} />
      ))}
    </div>
  );
}

function ProviderGroup({
  providerId,
  selected,
  onPick,
}: {
  providerId: ProviderId;
  selected: ModelSelection;
  onPick: (harness: ProviderId, model: string | null) => void;
}) {
  const { connection } = useAgentConnection(providerId);
  const connected = connection.connected;
  const provider = findProvider(providerId)!;
  const rows: Array<{ id: string | null; label: string; hint?: string }> = [
    { id: null, label: 'Auto', hint: 'Best available for this provider' },
    ...modelsForProvider(providerId),
  ];

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-1">
        <ProviderIcon id={providerId} size={13} />
        <span className="text-[12px] font-semibold text-foreground">{provider.name}</span>
        <ConnectionBadge harness={providerId} className="ml-auto" />
      </div>

      {/* Shows the login/check CTA only when the provider isn't cleanly connected. */}
      <ConnectionPanel harness={providerId} />

      <div className={cn('mt-1', !connected && 'opacity-50')}>
        {rows.map((m) => {
          const isSelected = selected.harness === providerId && selected.model === m.id;
          return (
            <button
              key={m.id ?? 'auto'}
              type="button"
              disabled={!connected}
              onClick={() => onPick(providerId, m.id)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed',
                isSelected ? 'bg-primary/10' : connected && 'hover:bg-muted/50',
              )}
            >
              <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                {isSelected && <Check size={12} className="text-primary" strokeWidth={3} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-foreground">{m.label}</div>
                {m.hint && <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground/80">{m.hint}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
