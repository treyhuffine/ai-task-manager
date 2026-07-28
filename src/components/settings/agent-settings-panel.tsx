'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Bot, Globe2, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { useUserState } from '@/hooks/use-user-state';
import { useAgentModels } from '@/hooks/use-agent-models';
import { useAgentHarnesses, useSaveHarnessModels, type HarnessSettingsView } from '@/hooks/use-agent-harnesses';
import { ProviderIcon, ConnectionBadge, ConnectionPanel } from './agent-connection-ui';
import { CursorCredentialPanel } from './cursor-credential-panel';
import { OpenCodeProviderPanel } from './opencode-provider-panel';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import {
  effortOptionsForModel,
  providerHarnessKey,
  type ModelOption,
} from '@/lib/agent-options';
import type { EffortLevel } from '@/db/types';
import { HARNESS_IDS, type HarnessId } from '@/lib/agents/registry';
import { cn } from '@/lib/utils';

export function AgentSettingsPanel() {
  const { data: userState } = useUserState();
  const { data, isLoading } = useAgentHarnesses();
  const savedActive = userState?.defaultAgentHarness ?? 'claude';
  const active: HarnessId = HARNESS_IDS.includes(savedActive) ? savedActive : 'claude';
  const [selectedTab, setSelectedTab] = useState<HarnessId | null>(null);
  const tab = selectedTab ?? active;

  return (
    <section className="space-y-4 text-[12px]">
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-foreground">
          <Bot size={14} className="text-muted-foreground" />
          <h3 className="text-[13px] font-semibold">Agent harnesses and models</h3>
        </div>
        <p className="text-[11px] text-muted-foreground/85">
          Connect providers, choose the models you want to see, and set the default for new work.
        </p>
      </header>

      {isLoading || !data ? <SettingsSkeleton rows={5} /> : (
        <>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1">
            {data.harnesses.map((harness) => (
              <button
                key={harness.id}
                type="button"
                onClick={() => setSelectedTab(harness.id)}
                className={cn(
                  'flex min-w-[110px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
                  tab === harness.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {harness.name}
                {active === harness.id && <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Default harness" />}
              </button>
            ))}
          </div>
          {data.harnesses.filter((harness) => harness.id === tab).map((harness) => (
            <HarnessPane key={`${harness.id}:${harness.settings.updatedAt}`} harness={harness} active={active === harness.id} />
          ))}
        </>
      )}

      <GlobalSkillSetting />
    </section>
  );
}

/**
 * Where agents may use this app's task and note actions. Global by default
 * (set during onboarding) so agents can manage tasks and notes from any
 * project. Turning this off scopes discovery to sessions the app launches from
 * its own directory. Individual repositories are never touched either way.
 */
function GlobalSkillSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<{ enabled: boolean; configured: boolean }>('/agent/skills/global')
      .then((res) => {
        if (active) setEnabled(res.enabled);
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await api.put('/agent/skills/global', { enabled: next });
      toast.success(
        next
          ? 'Agents can manage tasks and notes in every project'
          : 'Agent task and note access limited to inside the app',
      );
    } catch (error) {
      setEnabled(previous);
      toast.error('Could not update agent access', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/30 p-3">
      <div className="flex items-center gap-2 text-foreground">
        <Globe2 size={14} className="text-muted-foreground" />
        <h4 className="text-[12px] font-semibold">Task and note access</h4>
      </div>
      <p className="text-[11px] text-muted-foreground/85">
        Installs one user-level skill so agents can manage your tasks and notes from any project.
        Individual repositories stay untouched either way.
      </p>
      <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-foreground">
        <Checkbox
          checked={enabled === true}
          disabled={enabled === null || saving}
          onCheckedChange={(value) => void toggle(value === true)}
        />
        Available in every project
      </label>
    </div>
  );
}

function HarnessPane({ harness, active }: { harness: HarnessSettingsView; active: boolean }) {
  const catalog = useAgentModels(harness.id, { catalog: true });
  const save = useSaveHarnessModels();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState<string[]>(harness.settings.enabledModels);
  const [defaultModel, setDefaultModel] = useState<string | null>(harness.settings.defaultModel);
  const [defaultVariant, setDefaultVariant] = useState<string | null>(harness.settings.defaultVariant);
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel | null>(harness.settings.defaultEffort);

  const selectedDefault = catalog.models.find((model) => model.id === defaultModel) ?? null;
  const defaultAvailable = Boolean(selectedDefault && selectedDefault.availability !== 'unavailable');
  const variants = selectedDefault?.variants?.filter((variant) => !variant.disabled) ?? [];
  const efforts = effortOptionsForModel(providerHarnessKey(harness.id), selectedDefault);
  const dirty = useMemo(() => {
    const initial = catalog.data?.enabledModelIds ?? harness.settings.enabledModels;
    return [...initial].sort().join('\n') !== [...enabled].sort().join('\n')
      || defaultModel !== (catalog.data?.defaultModel ?? harness.settings.defaultModel)
      || defaultVariant !== (catalog.data?.defaultVariant ?? harness.settings.defaultVariant)
      || defaultEffort !== (catalog.data?.defaultEffort ?? harness.settings.defaultEffort);
  }, [catalog.data, defaultEffort, defaultModel, defaultVariant, enabled, harness.settings]);

  const persist = async (makeActive = false) => {
    try {
      await save.mutateAsync({
        harness: harness.id,
        enabledModelIds: enabled,
        defaultModel,
        defaultVariant,
        defaultEffort,
        makeActive,
      });
      toast.success(makeActive ? `${harness.name} is now the default` : `${harness.name} models saved`);
    } catch (error) {
      toast.error('Could not save agent settings', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/30 p-3">
      <div className="flex items-start gap-2.5">
        <ProviderIcon id={harness.id} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-foreground">{harness.name}</h4>
            <ConnectionBadge harness={harness.id} />
            {active && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Default</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{harness.description}</p>
          <p className="mt-1 text-[10.5px] text-muted-foreground/75">
            {harness.runtime.binary.status === 'supported'
              ? `Runtime ${harness.runtime.binary.version ?? 'detected'}`
              : harness.runtime.binary.reason ?? `Runtime status: ${harness.runtime.binary.status}`}
          </p>
        </div>
      </div>

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
        <VirtualModelChecklist
          models={catalog.models}
          query={query}
          enabled={enabled}
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
        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
          <LabeledSelect
            label="Default model"
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
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        {!active && (
          <Button type="button" size="sm" variant="outline" disabled={save.isPending || !defaultModel || !defaultAvailable} onClick={() => void persist(true)}>
            <ShieldCheck /> Use as default
          </Button>
        )}
        <Button type="button" size="sm" disabled={save.isPending || !dirty || !defaultModel || (active && !defaultAvailable)} onClick={() => void persist(false)}>
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
  onToggle,
}: {
  models: ModelOption[];
  query: string;
  enabled: string[];
  onToggle: (id: string, checked: boolean) => void;
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
          return (
            <label
              key={virtualRow.key}
              className={cn(
                'absolute left-0 top-0 flex w-full cursor-pointer items-center gap-2.5 border-b border-border/60 px-2.5 py-1.5 hover:bg-muted/40',
                model.availability === 'unavailable' && 'cursor-not-allowed opacity-60',
              )}
              style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
            >
              <Checkbox
                checked={checked}
                disabled={model.availability === 'unavailable'}
                onCheckedChange={(value) => onToggle(model.id, value === true)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                  <span className="truncate">{model.label}</span>
                  {model.providerName && <span className="truncate text-[10px] font-normal text-muted-foreground">{model.providerName}</span>}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {model.availability === 'unavailable' ? model.availabilityReason : model.hint ?? model.id}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
