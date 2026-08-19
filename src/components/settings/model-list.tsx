'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Loader2, MessageSquarePlus, Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import { PROVIDERS, findProvider, type ModelOption, type ProviderId } from '@/lib/agent-options';
import { useAgentConnection } from '@/hooks/use-agent-connection';
import { useAgentModels } from '@/hooks/use-agent-models';
import { useRemoveCustomModel, useSaveHarnessModels } from '@/hooks/use-agent-harnesses';
import { ProviderIcon, ConnectionBadge, ConnectionPanel } from './agent-connection-ui';
import { PinModelInput } from './pin-model-input';
import { cn } from '@/lib/utils';

export interface ModelSelection {
  harness: ProviderId;
  model: string;
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
  switchHintProvider,
  onManageModels,
}: {
  selected: ModelSelection;
  onPick: (harness: ProviderId, model: ModelOption) => void;
  className?: string;
  /**
   * When set, every provider OTHER than this one is flagged in its header as
   * "new chat" — picking it switches the session (a fresh thread) rather than
   * pinning a model in place. The composer passes the session's current
   * provider; settings/onboarding omit it (there a pick just sets a default).
   */
  switchHintProvider?: ProviderId;
  /** Optional composer footer that opens the model allowlist settings. */
  onManageModels?: () => void;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {PROVIDERS.map((p) => (
        <ProviderGroup
          key={p.id}
          providerId={p.id}
          selected={selected}
          onPick={onPick}
          isSwitch={switchHintProvider != null && p.id !== switchHintProvider}
        />
      ))}
      {onManageModels && (
        <button
          type="button"
          onClick={onManageModels}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Settings2 size={11} />
          Manage models
        </button>
      )}
    </div>
  );
}

function ProviderGroup({
  providerId,
  selected,
  onPick,
  isSwitch,
}: {
  providerId: ProviderId;
  selected: ModelSelection;
  onPick: (harness: ProviderId, model: ModelOption) => void;
  isSwitch?: boolean;
}) {
  const { connection } = useAgentConnection(providerId);
  const { models } = useAgentModels(providerId);
  // The allowlist is a snapshot of the catalog at the moment it was last
  // edited, so anything the provider shipped afterwards is invisible here
  // through no decision of the user's. The catalog read backs the drawer below
  // that keeps those models one click away instead of one settings trip away.
  const catalog = useAgentModels(providerId, { catalog: true });
  const save = useSaveHarnessModels();
  const removeCustom = useRemoveCustomModel();
  const queryClient = useQueryClient();
  const [showMore, setShowMore] = useState(false);
  const connected = connection.connected;
  const provider = findProvider(providerId)!;
  // Pinned ids sort above the catalog: they are the one part of this list the
  // user typed themselves, and an exact pin is meant to win over the tier
  // alias it was created to bypass.
  const rows = [...models.filter((m) => m.custom), ...models.filter((m) => !m.custom)];
  const hidden = catalog.models.filter(
    (m) => !m.enabled && m.availability !== 'unavailable',
  );

  /**
   * Reveal-and-use. Picking from the drawer also turns the model on, so a
   * narrowed allowlist repairs itself in place. Requiring a settings round trip
   * is what let a stale allowlist survive for months in the first place.
   */
  const revealAndPick = async (model: ModelOption) => {
    const settings = catalog.data;
    try {
      await save.mutateAsync({
        harness: providerId,
        enabledModelIds: [...(settings?.enabledModelIds ?? []), model.id],
        // Carry the rest of the tuple through untouched. Omitting these makes
        // the route resolve them from scratch, which silently discards the
        // user's configured default variant and effort.
        defaultModel: settings?.defaultModel ?? model.id,
        defaultVariant: settings?.defaultVariant ?? null,
        defaultEffort: settings?.defaultEffort ?? null,
      });
    } catch (error) {
      toast.error(`Could not turn on ${model.label}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // Settle the allowlist read before handing off. Consumers resolve the id
    // against the enabled list, so picking on a stale one lands on the wrong
    // model — silently, because resolution falls back rather than throwing.
    await queryClient.refetchQueries({ queryKey: ['agent-models', providerId] });
    onPick(providerId, model);
  };

  /**
   * Unpin. Nothing else can resolve a hand-typed id, so removing the one in
   * use has to hand the selection somewhere — otherwise the session keeps a
   * model that no longer exists anywhere and only says so on the next send.
   */
  const unpin = async (model: ModelOption) => {
    let settings;
    try {
      ({ settings } = await removeCustom.mutateAsync({ harness: providerId, modelId: model.id }));
    } catch (error) {
      toast.error(`Could not remove ${model.id}`, {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (selected.harness !== providerId || selected.model !== model.id) return;
    // A pin that shadowed a real catalog model outlives its own removal, so
    // there is nothing to hand off — the selection still resolves.
    if (settings.enabledModels.includes(model.id)) return;
    const fallback = rows.find((m) => m.id !== model.id && m.availability !== 'unavailable');
    if (fallback) onPick(providerId, fallback);
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-1">
        <ProviderIcon id={providerId} size={13} />
        <span className="text-[12px] font-semibold text-foreground">{provider.name}</span>
        {isSwitch && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground/70"
            title="Picking this provider starts a fresh chat"
          >
            <MessageSquarePlus size={10} />
            new chat
          </span>
        )}
        <ConnectionBadge harness={providerId} className="ml-auto" />
      </div>

      {/* Shows the login/check CTA only when the provider isn't cleanly connected. */}
      <ConnectionPanel harness={providerId} />

      <div className={cn('mt-1', !connected && 'opacity-50')}>
        {rows.map((m) => (
          <ModelRow
            key={m.id}
            model={m}
            selected={selected.harness === providerId && selected.model === m.id}
            disabled={!connected}
            onSelect={() => onPick(providerId, m)}
            onRemove={m.custom ? () => void unpin(m) : undefined}
            removePending={removeCustom.isPending && removeCustom.variables?.modelId === m.id}
          />
        ))}

        {/* Always available, even with nothing hidden: this drawer is also
            where a model id gets typed in, and that has to stay reachable
            when the allowlist already shows everything the catalog knows. */}
        <button
          type="button"
          onClick={() => setShowMore((open) => !open)}
          className="mt-0.5 flex w-full items-center gap-1 rounded-md px-2 py-1 text-[10.5px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
        >
          <ChevronRight
            size={10}
            className={cn('transition-transform', showMore && 'rotate-90')}
          />
          {showMore
            ? 'Show less'
            : hidden.length > 0
              ? `${hidden.length} more · pin a model ID`
              : 'Pin a model ID'}
        </button>
        {showMore && (
          <>
            <PinModelInput
              providerId={providerId}
              disabled={!connected}
              onPinned={(model) => {
                setShowMore(false);
                onPick(providerId, model);
              }}
            />
            {hidden.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                selected={false}
                disabled={!connected || save.isPending}
                muted
                pending={save.isPending && save.variables?.enabledModelIds.includes(m.id)}
                title={`Turn on ${m.label} and use it`}
                onSelect={() => void revealAndPick(m)}
                // A pin the user has since hidden still needs a way out, or
                // it can only be cleared from settings.
                onRemove={m.custom ? () => void unpin(m) : undefined}
                removePending={removeCustom.isPending && removeCustom.variables?.modelId === m.id}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  disabled,
  muted,
  pending,
  title,
  onSelect,
  onRemove,
  removePending,
}: {
  model: ModelOption;
  selected: boolean;
  disabled?: boolean;
  /** A row from the hidden drawer: present, but visibly not part of the set. */
  muted?: boolean;
  pending?: boolean;
  title?: string;
  onSelect: () => void;
  /** Present on pinned rows only — the catalog's own models can't be removed. */
  onRemove?: () => void;
  removePending?: boolean;
}) {
  return (
    <div
      className={cn(
        'group/row relative rounded-md transition-colors',
        selected ? 'bg-primary/10' : !disabled && 'hover:bg-muted/50',
        muted && 'opacity-60 hover:opacity-100',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        title={title ?? (model.custom ? `Pinned: ${model.id}` : undefined)}
        onClick={onSelect}
        className={cn(
          'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed',
          onRemove && 'pr-7',
        )}
      >
        <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {pending && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
          {!pending && selected && <Check size={12} className="text-primary" strokeWidth={3} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-foreground">{model.label}</span>
            {model.custom && (
              <span className="rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                pinned
              </span>
            )}
          </div>
          {model.hint && (
            <div
              className={cn(
                'mt-0.5 text-[10.5px] leading-snug text-muted-foreground/80',
                model.custom && 'truncate font-mono',
              )}
            >
              {model.hint}
            </div>
          )}
        </div>
      </button>
      {onRemove && (
        <button
          type="button"
          disabled={removePending}
          onClick={onRemove}
          title={`Unpin ${model.id}`}
          aria-label={`Unpin ${model.id}`}
          // Visible without hovering: a pin is the one row here the user has to
          // be able to undo, and hover-only affordances don't exist on touch.
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/50 transition-opacity',
            'hover:bg-muted hover:text-foreground group-hover/row:text-muted-foreground',
            removePending && 'text-muted-foreground',
          )}
        >
          {removePending ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
        </button>
      )}
    </div>
  );
}
