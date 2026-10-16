'use client';

/**
 * Connectors → Sources (docs/connector-service-spec.md §2): the services that hold connected
 * accounts for Ri, so apps connect without an OAuth app of your own. Composio is the first.
 * Set it up once with a project API key, see whether it's working, choose which source new
 * connections prefer, and turn one off or remove it. Turning a source off stops Ri from using it
 * and changes nothing in Composio.
 */
import { useRef, useState } from 'react';
import { AlertCircle, ExternalLink, KeyRound, Loader2, Pencil, Plus, Trash2, Waypoints } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Tip } from '@/components/ui/tip';
import { APPLICATIONS } from '@/lib/integrations/sources/applications';
import { sourceErrorMessage, useSourceMutations, useSourcesOverview } from '@/hooks/use-integration-sources';
import type { SourceView } from '@/lib/integrations/sources/service';
import { BackLink, Chip, DetailHeader, GroupHeading, type Tone } from './parts';

const COMPOSIO_DASHBOARD = 'https://dashboard.composio.dev';
const COMPOSIO_CUSTODY = 'https://docs.composio.dev/docs/security/token-custody';

export function SourcesPanel({ onBack, onChanged }: { onBack: () => void; onChanged?: () => void }) {
  const overview = useSourcesOverview();
  const sources = overview.data?.sources ?? [];
  const [adding, setAdding] = useState(false);
  const preferences = overview.data?.preferences;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={onBack} busy={overview.isFetching && !overview.data} />
        <DetailHeader
          logo={<span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground ring-1 ring-inset ring-border/50" aria-hidden><Waypoints size={22} /></span>}
          title="Connection sources"
          subtitle="A source keeps the accounts you connect through it and signs in to apps for Ri, so you don't register an OAuth app for each one."
        />
      </div>

      {(preferences?.status === 'invalid' || preferences?.status === 'unsupported') && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Connection preferences can&apos;t be read</p>
            <p className="opacity-90">{preferences.error} The file was left unchanged at {preferences.file}. Direct connections keep working. Repair or move it to use sources again.</p>
          </div>
        </div>
      )}

      {overview.error && <p role="alert" className="text-xs text-destructive">{sourceErrorMessage(overview.error)}</p>}

      {sources.length > 0 && (
        <section className="space-y-2">
          <GroupHeading count={sources.length}>Your sources</GroupHeading>
          <div className="space-y-2">
            {sources.map(source => <SourceCard key={source.id} source={source} onChanged={onChanged} />)}
          </div>
        </section>
      )}

      {overview.data && (sources.length === 0 || adding) && (
        <ComposioSetup
          first={sources.length === 0}
          onDone={() => { setAdding(false); onChanged?.(); }}
          onCancel={sources.length > 0 ? () => setAdding(false) : undefined}
        />
      )}
      {sources.length > 0 && !adding && (
        <Button variant="ghost" size="xs" className="text-xs text-muted-foreground" onClick={() => setAdding(true)}>
          <Plus size={12} /> Add another Composio project
        </Button>
      )}
    </div>
  );
}

const HEALTH: Record<SourceView['health']['state'], { tone: Tone | 'neutral'; label: string }> = {
  ok: { tone: 'ok', label: 'Working' },
  unknown: { tone: 'neutral', label: 'Not checked yet' },
  disabled: { tone: 'off', label: 'Off' },
  no_key: { tone: 'warn', label: 'Key needed' },
  key_rejected: { tone: 'error', label: 'Key rejected' },
  unreachable: { tone: 'warn', label: 'Unreachable' },
  cached: { tone: 'warn', label: 'Using saved tools' },
};

function accountSummary(source: SourceView): string {
  const parts = source.accounts.filter(entry => entry.count > 0)
    .map(entry => `${entry.count} ${APPLICATIONS[entry.applicationId].displayName} account${entry.count === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'No accounts yet';
}

function SourceCard({ source, onChanged }: { source: SourceView; onChanged?: () => void }) {
  const m = useSourceMutations();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(source.health.state === 'no_key' || source.health.state === 'key_rejected');
  const [key, setKey] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(source.label);
  const revokeRemote = useRef(false);
  const health = HEALTH[source.health.state];
  const total = source.accounts.reduce((n, entry) => n + entry.count, 0);
  const busy = m.setEnabled.isPending || m.remove.isPending || m.rotateKey.isPending || m.setPreferred.isPending || m.rename.isPending;

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      onChanged?.();
    } catch (e) {
      setError(sourceErrorMessage(e));
    }
  };

  const toggle = async (enabled: boolean) => {
    if (!enabled && total > 0 && !(await confirm({
      title: `Turn off ${source.label}?`,
      description: `${total === 1 ? 'Its account stops' : `Its ${total} accounts stop`} working in Ri until you turn it back on. Nothing changes in Composio.`,
      confirmLabel: 'Turn off',
    }))) return;
    await run(() => m.setEnabled.mutateAsync({ sourceId: source.id, enabled }));
  };

  const remove = async () => {
    revokeRemote.current = false;
    const ok = await confirm({
      title: `Remove ${source.label}?`,
      description: total > 0
        ? `${total === 1 ? 'Its account leaves' : `Its ${total} accounts leave`} Ri, and agents lose access to ${total === 1 ? 'it' : 'them'}. Ri forgets the key.`
        : 'Ri forgets the key. You can set it up again later.',
      tone: 'destructive',
      confirmLabel: 'Remove',
      ...(total > 0 ? {
        content: (
          <label className="flex items-start gap-2 text-xs text-foreground">
            <Checkbox onCheckedChange={value => { revokeRemote.current = value === true; }} className="mt-0.5" />
            <span>Also revoke {total === 1 ? 'that account' : 'those accounts'} in Composio. Otherwise {total === 1 ? 'it stays' : 'they stay'} in your Composio project.</span>
          </label>
        ),
      } : {}),
    });
    if (!ok) return;
    await run(async () => {
      const result = await m.remove.mutateAsync({ sourceId: source.id, revokeRemote: revokeRemote.current });
      if (result.remoteRemaining > 0 && revokeRemote.current) {
        setError(`${result.remoteRemaining} account${result.remoteRemaining === 1 ? '' : 's'} could not be revoked in Composio. Remove ${result.remoteRemaining === 1 ? 'it' : 'them'} there.`);
      }
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/20 p-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={e => { e.preventDefault(); void run(async () => { await m.rename.mutateAsync({ sourceId: source.id, label: name }); setRenaming(false); }); }}
            >
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={60} aria-label="Source name" className="h-7 text-xs" autoFocus />
              <Button type="submit" size="xs" disabled={busy || !name.trim()}>Save</Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => { setRenaming(false); setName(source.label); }}>Cancel</Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">{source.label}</span>
              {source.preferred && <Chip tone="ok">Preferred</Chip>}
              <Tip label={source.health.detail} onlyWhenTextHidden={!source.health.detail}>
                <span><Chip tone={health.tone}>{health.label}</Chip></span>
              </Tip>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {source.project?.name ? `Project ${source.project.name}. ` : ''}{accountSummary(source)}
          </p>
          {source.health.detail && source.health.state !== 'ok' && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">{source.health.detail}</p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!source.preferred && source.enabled && (
            <Button variant="ghost" size="xs" className="text-xs" disabled={busy}
              onClick={() => void run(() => m.setPreferred.mutateAsync({ sourceId: source.id }))}>
              Make preferred
            </Button>
          )}
          <Tip label="Rename">
            <Button variant="ghost" size="icon-xs" aria-label={`Rename ${source.label}`} disabled={busy} onClick={() => setRenaming(true)}>
              <Pencil size={12} />
            </Button>
          </Tip>
          <Button variant="ghost" size="xs" className="text-xs" disabled={busy} onClick={() => setKeyOpen(open => !open)}>
            <KeyRound size={12} /> Update key
          </Button>
          <Button variant="ghost" size="xs" className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={12} /> Remove
          </Button>
          <Tip label={source.enabled ? `Ri uses ${source.label}` : `Ri doesn't use ${source.label}`}>
            <span className="pl-1">
              <Switch checked={source.enabled} disabled={busy} aria-label={`Use ${source.label}`} onCheckedChange={on => void toggle(on)} />
            </span>
          </Tip>
        </div>
      </div>

      {keyOpen && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3"
          onSubmit={e => { e.preventDefault(); void run(async () => { await m.rotateKey.mutateAsync({ sourceId: source.id, apiKey: key }); setKey(''); setKeyOpen(false); }); }}
        >
          <Input
            type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)}
            placeholder="New project API key" aria-label={`New project API key for ${source.label}`} className="h-8 min-w-0 flex-1 basis-56 text-xs"
          />
          <Button type="submit" size="sm" className="text-xs" disabled={busy || !key.trim()}>
            {m.rotateKey.isPending ? <Loader2 size={12} className="animate-spin" /> : null} Save key
          </Button>
          <p className="w-full text-[11px] text-muted-foreground">
            The new key must reach the same Composio project and its accounts. A key for another project is a new source.
          </p>
        </form>
      )}

      {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function ComposioSetup({ first, onDone, onCancel }: { first: boolean; onDone: () => void; onCancel?: () => void }) {
  const m = useSourceMutations();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await m.addComposio.mutateAsync({ apiKey: key, ...(label.trim() ? { label: label.trim() } : {}) });
      setKey('');
      onDone();
    } catch (e) {
      setError(sourceErrorMessage(e));
    }
  };

  return (
    <section className="space-y-2">
      <GroupHeading action={onCancel && <Button variant="ghost" size="xs" className="text-xs" onClick={onCancel}>Cancel</Button>}>
        {first ? 'Set up Composio' : 'Another Composio project'}
      </GroupHeading>
      <div className="space-y-4 rounded-xl border border-border bg-card/20 p-4">
        <div className="space-y-2 text-xs leading-normal text-foreground/90">
          <p>
            Composio stores the accounts you connect through it and runs their tool calls. When an agent reads your mail or
            calendar through Composio, that content passes through Composio. Usage counts against your own Composio plan.
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>Create a project in Composio for this Ri.</li>
            <li>Copy the project&apos;s API key from its settings.</li>
            <li>Paste it here. Then connect Gmail or Google Calendar with a browser sign-in.</li>
          </ol>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={COMPOSIO_DASHBOARD} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Open Composio <ExternalLink size={11} />
            </a>
            <a href={COMPOSIO_CUSTODY} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              How Composio keeps accounts <ExternalLink size={11} />
            </a>
          </div>
        </div>
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); void save(); }}>
          {!first && (
            <Input value={label} onChange={e => setLabel(e.target.value)} maxLength={60} placeholder="Name, like Composio Work" aria-label="Source name" className="h-8 text-xs" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)}
              placeholder="Project API key" aria-label="Composio project API key" className="h-8 min-w-0 flex-1 basis-56 text-xs"
            />
            <Button type="submit" size="sm" className="text-xs font-semibold" disabled={m.addComposio.isPending || !key.trim()}>
              {m.addComposio.isPending && <Loader2 size={12} className="animate-spin" />} Save key
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The key lets Ri reach your Composio project. It isn&apos;t a sign-in to any app. It stays sealed on this home and isn&apos;t shown again.
          </p>
          {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
        </form>
      </div>
    </section>
  );
}
