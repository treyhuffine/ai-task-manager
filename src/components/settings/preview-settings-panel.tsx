'use client';

import { useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreviewSettings, useUpdatePreviewSettings } from '@/hooks/use-preview';
import { BeamdConnect } from './beamd-connect';

/**
 * Global preview-reachability settings: choose the active remote provider
 * and configure it. Localhost-only needs nothing; Beamd needs a server +
 * token; Manual takes a default URL template. Lives in the Devices sheet
 * alongside the other local/remote handoff controls.
 */
export function PreviewSettingsPanel() {
  const { data: settings, isLoading } = usePreviewSettings();
  const update = useUpdatePreviewSettings();

  const [manualTemplate, setManualTemplate] = useState('');

  // Hydrate local fields from server settings once loaded.
  useEffect(() => {
    if (!settings) return;
    setManualTemplate(settings.manualTemplate ?? '');
  }, [settings]);

  if (isLoading || !settings) {
    return <PanelShell><p className="text-muted-foreground">Loading preview settings…</p></PanelShell>;
  }

  const active = settings.activeProvider;

  const selectProvider = (id: string) => {
    update.mutate({ activeProvider: id });
  };

  // Connecting beamd implies you want to use it — if the picker is still on
  // localhost-only, switch it over so remote previews actually resolve.
  const handleBeamdConnected = () => {
    if (settings.activeProvider === 'localhost') update.mutate({ activeProvider: 'beamd' });
  };

  return (
    <PanelShell>
      <div className="space-y-3">
        <p className="text-muted-foreground">
          How previews are reached when you&apos;re not on the machine running the app.
        </p>

        {/* Provider radio list */}
        <div className="space-y-1.5">
          {settings.providers.map((p) => (
            <ProviderRow
              key={p.id}
              id={p.id}
              label={providerLabel(p.id, p.label)}
              description={providerDescription(p.id)}
              selected={active === p.id}
              onSelect={() => selectProvider(p.id)}
            />
          ))}
        </div>

        {/* Beamd account — machine-level (the shared `~/.beamd` login), shown
            always so you can connect or fix it here no matter which provider is
            active. */}
        <div className="space-y-1.5 border-t border-border pt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Beamd · this machine
          </h4>
          <BeamdConnect onConnected={handleBeamdConnected} />
        </div>

        {/* Manual template */}
        {active === 'manual' && (
          <div className="rounded-md border border-border bg-card/40 p-3 space-y-2.5">
            <Field label="Default URL template">
              <input
                value={manualTemplate}
                onChange={(e) => setManualTemplate(e.target.value)}
                placeholder="https://{name}.mytunnel.com"
                spellCheck={false}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              Used when no explicit URL is pasted on an execution. <code className="rounded bg-muted px-1">{'{name}'}</code> is the preview name.
            </p>
            <button
              type="button"
              onClick={() => update.mutate({ manualTemplate: manualTemplate.trim() || null })}
              disabled={update.isPending}
              className="flex items-center gap-1.5 rounded border border-border bg-foreground px-2.5 py-1.5 text-[12px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              {update.isPending && <Loader2 size={12} className="animate-spin" />}
              Save
            </button>
          </div>
        )}

      </div>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4 text-[12px]">
      <header className="flex items-center gap-2 text-foreground">
        <Globe size={14} className="text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">Remote preview</h3>
      </header>
      {children}
    </section>
  );
}

function ProviderRow({
  id, label, description, selected, onSelect,
}: {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
        selected ? 'border-primary/60 bg-primary/5' : 'border-border bg-card/40 hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-primary' : 'border-muted-foreground/40',
        )}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>
      <span className="flex flex-col">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function providerLabel(id: string, fallback: string): string {
  if (id === 'localhost') return 'Localhost only';
  return fallback;
}

function providerDescription(id: string): string {
  switch (id) {
    case 'localhost':
      return 'Previews only load on this machine. No remote access.';
    case 'beamd':
      return 'Connect your Beamd account, or self-host for free. Reachable anywhere.';
    case 'manual':
      return 'Run your own tunnel and paste the URL on each execution.';
    default:
      return 'Community provider.';
  }
}
