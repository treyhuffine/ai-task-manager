'use client';

import { HarnessPermissionNotice } from './harness-permission-notice';

import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import type { EffortLevel } from '@/db/types';
import { useHarnessModels } from '@/hooks/use-harness-models';
import {
	useHarnesses,
	useRemoveCustomModel,
	useSaveHarnessModels,
	type HarnessSettingsView,
} from '@/hooks/use-harnesses';
import { useUserState } from '@/hooks/use-user-state';
import {
	effortOptionsForModel,
	type ModelOption,
} from '@/lib/harness/options';
import { cn } from '@/lib/utils';
import { serviceTierForModel, serviceTierOptions } from '@/lib/harness/service-tiers';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CursorCredentialPanel } from './cursor-credential-panel';
import { ConnectionBadge, ConnectionPanel, ProviderIcon } from './harness-connection-ui';
import { OpenCodeProviderPanel } from './opencode-provider-panel';
import { PinModelInput } from './pin-model-input';
import { Tip } from '@/components/ui/tip';

/**
 * Every harness as one row that opens in place: its sign-in, the models it
 * shows and its own default. The global default model is its own section
 * above (`DefaultModelSection`).
 */
export function HarnessSettingsPanel() {
  const { data: userState } = useUserState();
  const { data, isLoading } = useHarnesses();

  return (
    <section className="@container space-y-3 text-[12px]">
      <header className="space-y-0.5">
        <h3 className="text-[13px] font-semibold text-foreground">Harnesses and models</h3>
        <p className="text-[11px] text-muted-foreground/85">
          Connect each harness, choose the models it shows, and set its own default.
        </p>
      </header>

      {isLoading || !data ? <SettingsSkeleton rows={5} /> : (
        <Accordion type="multiple" className="rounded-lg">
          {data.harnesses.map((harness) => (
            <AccordionItem key={harness.id} value={harness.id} data-harness-row={harness.id}>
              <AccordionTrigger className="items-center gap-3 p-3 hover:no-underline">
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  <ProviderIcon id={harness.id} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-foreground">{harness.name}</span>
                      <ConnectionBadge harness={harness.id} />
                    </span>
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {harness.description}
                    </span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="h-auto pb-3 [&_p:not(:last-child)]:mb-0 [&_a]:no-underline">
                <HarnessPane
                  key={`${harness.id}:${harness.settings.updatedAt}`}
                  harness={harness}
                  globalDefaultModel={userState?.defaultHarness === harness.id ? userState.defaultModel ?? null : null}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </section>
  );
}

/**
 * One harness, opened: its sign-in, the models it shows, and its own default,
 * used when something picks this harness without a model. Separate from the
 * global default model, even on the global default's harness.
 */
function HarnessPane({
  harness,
  globalDefaultModel,
}: {
  harness: HarnessSettingsView;
  /** The global default model, when it's on this harness. It stays visible. */
  globalDefaultModel: string | null;
}) {
  const catalog = useHarnessModels(harness.id, { catalog: true });
  const save = useSaveHarnessModels();
  const removeCustom = useRemoveCustomModel();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState<string[]>(harness.settings.enabledModels);
  const [defaultModel, setDefaultModel] = useState<string | null>(harness.settings.defaultModel);
  const [defaultVariant, setDefaultVariant] = useState<string | null>(harness.settings.defaultVariant);
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel | null>(harness.settings.defaultEffort);
  const [defaultServiceTier, setDefaultServiceTier] = useState<string | null>(harness.settings.defaultServiceTier);

  const selectedDefault = catalog.models.find((model) => model.id === defaultModel) ?? null;
  const variants = selectedDefault?.variants?.filter((variant) => !variant.disabled) ?? [];
  const efforts = effortOptionsForModel(harness.id, selectedDefault);
  const speeds = serviceTierOptions(selectedDefault);
  const dirty = useMemo(() => {
    const initial = catalog.data?.enabledModelIds ?? harness.settings.enabledModels;
    return [...initial].sort().join('\n') !== [...enabled].sort().join('\n')
      || defaultModel !== (catalog.data?.defaultModel ?? harness.settings.defaultModel)
      || defaultVariant !== (catalog.data?.defaultVariant ?? harness.settings.defaultVariant)
      || defaultEffort !== (catalog.data?.defaultEffort ?? harness.settings.defaultEffort)
      || defaultServiceTier !== (catalog.data?.defaultServiceTier ?? harness.settings.defaultServiceTier);
  }, [catalog.data, defaultEffort, defaultModel, defaultVariant, defaultServiceTier, enabled, harness.settings]);

  const persist = async () => {
    try {
      await save.mutateAsync({
        harness: harness.id,
        enabledModelIds: enabled,
        defaultModel,
        defaultVariant,
        defaultEffort,
        defaultServiceTier,
      });
      toast.success(`${harness.name} models saved`);
    } catch (error) {
      toast.error('Could not save harness settings', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="space-y-4 text-[12px]">
      <p className="text-[10.5px] text-muted-foreground/75">
        {harness.runtime.binary.status === 'supported'
          ? `Runtime ${harness.runtime.binary.version ?? 'detected'}`
          : harness.runtime.binary.reason ?? `Runtime status: ${harness.runtime.binary.status}`}
      </p>

      <HarnessPermissionNotice harness={harness.id} />
      <ConnectionPanel harness={harness.id} showSignedIn />
      {harness.id === 'cursor' && <CursorCredentialPanel />}
      {harness.id === 'opencode' && <OpenCodeProviderPanel />}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium text-foreground">Visible models</p>
            <p className="text-[10.5px] text-muted-foreground">
              {enabled.length} selected. Only selected models appear in the composer.
            </p>
          </div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              void catalog.refresh().catch((error) => {
                toast.error('Could not refresh models', { description: error instanceof Error ? error.message : String(error) });
              }).finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models"
            className="h-8 rounded-md pl-8 text-[11px]"
          />
        </div>
        {/* Pinning saves on its own (the id has to exist before anything can
            validate against it), so the pending local edits mirror it rather
            than overwrite it on the next Save. */}
        <PinModelInput
          providerId={harness.id}
          onPinned={(model) => {
            setEnabled((prev) => [...new Set([...prev, model.id])]);
            setDefaultModel((prev) => prev ?? model.id);
            setQuery('');
          }}
        />
        <VirtualModelChecklist
          models={catalog.models}
          query={query}
          enabled={enabled}
          globalDefaultModel={globalDefaultModel}
          removing={removeCustom.isPending ? removeCustom.variables?.modelId ?? null : null}
          onRemove={(id) => {
            void removeCustom.mutateAsync({ harness: harness.id, modelId: id })
              .then(() => {
                setEnabled((prev) => prev.filter((entry) => entry !== id));
                setDefaultModel((prev) => (prev === id ? null : prev));
              })
              .catch((error: unknown) => {
                toast.error(`Could not remove ${id}`, {
                  description: error instanceof Error ? error.message : String(error),
                });
              });
          }}
          onToggle={(id, checked) => {
            const next = checked ? [...new Set([...enabled, id])] : enabled.filter((modelId) => modelId !== id);
            setEnabled(next);
            if (!checked && defaultModel === id) {
              setDefaultModel(next[0] ?? null);
              setDefaultVariant(null);
            } else if (checked && !defaultModel) {
              setDefaultModel(id);
            }
          }}
        />
        {!catalog.isLoading && catalog.models.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            No models were discovered. Connect the provider and refresh the catalog.
          </p>
        )}
      </div>

      {enabled.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div>
            <p className="font-medium text-foreground">When something picks {harness.name} without a model</p>
            <p className="text-[10.5px] text-muted-foreground">
              {harness.name}’s own default, separate from the global default model above.
            </p>
          </div>
          <div className="grid gap-2 @min-[400px]:grid-cols-3">
            <LabeledSelect
              label="Model"
              value={defaultModel ?? enabled[0] ?? ''}
              options={enabled.map((id) => {
                const model = catalog.models.find((entry) => entry.id === id);
                const unavailable = model?.availability === 'unavailable';
                return {
                  id,
                  label: `${model?.label ?? id}${unavailable ? ' (Unavailable)' : ''}`,
                  disabled: unavailable,
                };
              })}
              onValue={(value) => {
                setDefaultModel(value);
                const model = catalog.models.find((entry) => entry.id === value);
                setDefaultVariant(model?.variants?.find((variant) => variant.isDefault)?.id ?? null);
                setDefaultServiceTier(serviceTierForModel(model, defaultServiceTier));
              }}
            />
            {variants.length > 0 && (
              <LabeledSelect
                label="Variant"
                value={defaultVariant ?? '__default'}
                options={[
                  { id: '__default', label: 'Provider default' },
                  ...variants.map((variant) => ({ id: variant.id, label: variant.name })),
                ]}
                onValue={(value) => setDefaultVariant(value === '__default' ? null : value)}
              />
            )}
            {efforts.length > 0 && (
              <LabeledSelect
                label="Reasoning"
                value={defaultEffort ?? selectedDefault?.defaultEffort ?? 'medium'}
                options={efforts.map((effort) => ({ id: effort.id, label: effort.label }))}
                onValue={(value) => setDefaultEffort(value as EffortLevel)}
              />
            )}
            {(speeds.some(speed => speed.id !== 'default') || (defaultServiceTier && speeds.length > 0)) && (
              <LabeledSelect label="Speed" value={defaultServiceTier ?? 'default'}
                options={speeds} onValue={setDefaultServiceTier} />
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" disabled={save.isPending || !dirty || !defaultModel} onClick={() => void persist()}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save models
        </Button>
      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onValue,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string; disabled?: boolean }>;
  onValue: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-[10.5px] text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onValue}>
        <SelectTrigger size="sm" className="mt-1 w-full rounded-md text-[11px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.id} value={option.id} disabled={option.disabled}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function VirtualModelChecklist({
  models,
  query,
  enabled,
  globalDefaultModel,
  removing,
  onToggle,
  onRemove,
}: {
  models: ModelOption[];
  query: string;
  enabled: string[];
  /** The global default model, when it's on this harness. It stays visible. */
  globalDefaultModel?: string | null;
  /** Id of the pinned model whose removal is in flight. */
  removing?: string | null;
  onToggle: (id: string, checked: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) => [model.label, model.id, model.providerName, model.hint]
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [models, query]);
  // TanStack Virtual intentionally returns imperative functions that the
  // React compiler does not memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  return (
    <div ref={scrollRef} className="max-h-72 min-h-0 overflow-y-auto rounded-md border border-border [scrollbar-width:thin]">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const model = rows[virtualRow.index]!;
          const checked = enabled.includes(model.id);
          const isGlobalDefault = model.id === globalDefaultModel && checked;
          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 top-0 flex w-full items-center gap-1 border-b border-border/60 pr-1.5 hover:bg-muted/40"
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              <label
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2.5 py-1.5',
                  model.availability === 'unavailable' && 'cursor-not-allowed opacity-60',
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={model.availability === 'unavailable' || isGlobalDefault}
                  onCheckedChange={(value) => onToggle(model.id, value === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                    <span className="truncate">{model.label}</span>
                    {model.custom && (
                      <span className="rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        pinned
                      </span>
                    )}
                    {isGlobalDefault && (
                      <Tip label="Your global default model stays visible. Change the default model to hide this one.">
                        <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-primary">
                          global default
                        </span>
                      </Tip>
                    )}
                    {model.providerName && <span className="truncate text-[10px] font-normal text-muted-foreground">{model.providerName}</span>}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {model.availability === 'unavailable' ? model.availabilityReason : model.hint ?? model.id}
                  </span>
                </span>
              </label>
              {model.custom && (
                <Tip label={`Unpin ${model.id}`}>
                  <button
                    type="button"
                    disabled={removing === model.id}
                    onClick={() => onRemove(model.id)}
                    aria-label={`Unpin ${model.id}`}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {removing === model.id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <X size={11} />}
                  </button>
                </Tip>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
