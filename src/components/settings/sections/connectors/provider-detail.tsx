'use client';

/**
 * Detail view for one connector provider. Everything the catalog tile used to
 * cram into inline buttons and dropdowns lives here, stacked in the order a
 * person needs it: who is connected, how to connect (or add another account),
 * what agents can do with it, and the Advanced bring-your-own OAuth app.
 */
import { useState, type FormEvent } from 'react';
import { ChevronDown, ExternalLink, KeyRound, Loader2, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { connectorMeta } from '@/components/connectors/connector-meta';
import { ByoPanel } from './byo-panel';
import { BackLink, Chip, DetailHeader, GroupHeading } from './parts';
import {
  connectionIdentity,
  prettyField,
  SECRETY,
  type ActionInfo,
  type ApprovalMode,
  type AuthConfigSummary,
  type ByoForm,
  type Connection,
  type ProviderStatus,
  type TestResult,
  type ToolkitInfo,
  type WritePolicyAction,
} from './types';

/** Past this many tools the list gets a filter box. */
const TOOL_FILTER_THRESHOLD = 8;

export interface ProviderDetailProps {
  provider: ProviderStatus;
  connections: Connection[];
  /** This provider's toolkits only. */
  toolkits: ToolkitInfo[];
  writePolicy: Record<string, WritePolicyAction>;
  busy: boolean;
  testing: string | null;
  testResults: Record<string, TestResult>;
  /** Paste-a-key field values for this provider. */
  creds: Record<string, string>;
  /** Toolkit ids checked under "Services to grant". */
  selectedServices: string[];
  advancedOpen: boolean;
  redirectUri: string;
  copied: boolean;
  byoConfigs: AuthConfigSummary[];
  byoForm: ByoForm;
  onBack: () => void;
  onConnectOAuth: (authConfigId?: string) => void;
  onConnectDirect: () => void;
  onCredChange: (field: string, value: string) => void;
  onToggleService: (toolkitId: string) => void;
  onTest: (connectionId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onSetApproval: (actionId: string, mode: ApprovalMode) => void;
  onToggleAdvanced: () => void;
  onCopyRedirect: () => void;
  onByoField: (field: keyof ByoForm, value: string) => void;
  onByoAdd: () => void;
  onByoSetDefault: (id: string) => void;
  onByoDelete: (id: string) => void;
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { provider: p, connections: conns, toolkits, busy } = props;
  const meta = connectorMeta(p.id);
  const connected = conns.length > 0;
  const healthy = conns.every((c) => c.status === 'active');
  const toolCount = toolkits.reduce((n, t) => n + t.actions.length, 0);
  const canConnect = !p.orphan;

  // "Add another account" is a one-shot intent: a finished connect (or the last
  // disconnect) changes the account count and folds the form away again.
  const [addOpen, setAddOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(conns.length);
  if (seenCount !== conns.length) {
    setSeenCount(conns.length);
    setAddOpen(false);
  }
  const showConnect = canConnect && (!connected || addOpen);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={props.onBack} busy={busy} />
        <DetailHeader
          logo={<ConnectorLogo providerId={p.id} name={p.displayName} size={48} />}
          title={p.displayName}
          subtitle={p.orphan ? 'No longer offered. Disconnect to clean up.' : meta.description}
          meta={
            <>
              {connected ? (
                <Chip tone={healthy ? 'ok' : 'warn'}>
                  {conns.length > 1 ? `${conns.length} accounts connected` : healthy ? 'Connected' : 'Needs attention'}
                </Chip>
              ) : (
                <Chip>Not connected</Chip>
              )}
              {!p.orphan && <Chip>{meta.category}</Chip>}
              {toolCount > 0 && (
                <Chip>
                  {toolCount} tool{toolCount === 1 ? '' : 's'}
                </Chip>
              )}
            </>
          }
        />
      </div>

      {connected && (
        <section className="space-y-2">
          <GroupHeading
            count={conns.length}
            action={
              canConnect &&
              !addOpen && (
                <Button variant="outline" size="xs" onClick={() => setAddOpen(true)} disabled={busy} className="text-xs">
                  <Plus size={12} /> Add account
                </Button>
              )
            }
          >
            Accounts
          </GroupHeading>
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-card/20">
            {conns.map((c) => (
              <AccountRow
                key={c.id}
                connection={c}
                busy={busy}
                testing={props.testing === c.id}
                result={props.testResults[c.id]}
                onTest={() => props.onTest(c.id)}
                onDisconnect={() => props.onDisconnect(c.id)}
              />
            ))}
          </div>
        </section>
      )}

      {showConnect && (
        <section className="space-y-2">
          <GroupHeading
            action={
              connected && (
                <Button variant="ghost" size="xs" onClick={() => setAddOpen(false)} className="text-xs">
                  Cancel
                </Button>
              )
            }
          >
            {connected ? 'Add another account' : 'Connect'}
          </GroupHeading>
          <div className="rounded-xl border border-border bg-card/20 p-4">
            <ConnectPanel {...props} />
          </div>
        </section>
      )}

      {toolCount > 0 && (
        <ToolList toolkits={toolkits} writePolicy={props.writePolicy} onSetApproval={props.onSetApproval} />
      )}

      {p.method === 'oauth2' && p.configured && canConnect && (
        <section className="rounded-xl border border-border/70">
          <button
            type="button"
            aria-expanded={props.advancedOpen}
            onClick={props.onToggleAdvanced}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
          >
            <KeyRound size={14} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">Use your own OAuth app</span>
              <span className="block text-[11px] text-muted-foreground">
                Advanced. Connect through an app you registered with {p.displayName}.
              </span>
            </span>
            <ChevronDown
              size={14}
              className={cn('shrink-0 text-muted-foreground transition-transform', props.advancedOpen && 'rotate-180')}
            />
          </button>
          {props.advancedOpen && (
            <div className="border-t border-border/60 p-3">
              <Byo {...props} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Connect ─────────────────────────────────────────────────

/** The one connect flow that fits this provider: OAuth sign-in, own-app setup, or paste-a-key. */
function ConnectPanel(props: ProviderDetailProps) {
  const { provider: p, toolkits, busy } = props;
  const again = props.connections.length > 0;

  // OAuth with no bundled client: registering your own app IS the connect flow.
  if (p.method === 'oauth2' && !p.configured) {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-normal text-foreground/90">
          {p.displayName} connects through an OAuth app you register yourself. It takes a few minutes and the app
          stays yours.
        </p>
        <Byo {...props} />
      </div>
    );
  }

  if (p.method === 'oauth2') {
    const multi = toolkits.length > 1;
    const selected = props.selectedServices;
    return (
      <div className="space-y-4">
        {multi && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-foreground">Services to grant</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 @lg:grid-cols-3">
              {toolkits.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs text-foreground/90">
                  <Checkbox
                    checked={selected.includes(t.id)}
                    disabled={busy}
                    onCheckedChange={() => props.onToggleService(t.id)}
                  />
                  <span className="truncate">{t.displayName}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Only requests access to the services you check. You can grant more later.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            size="sm"
            onClick={() => props.onConnectOAuth()}
            disabled={busy || (multi && selected.length === 0)}
            className="text-xs font-semibold"
          >
            <ExternalLink size={13} /> {again ? 'Sign in to another account' : `Connect ${p.displayName}`}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Opens {p.displayName} to approve access, then brings you back here.
          </span>
        </div>
      </div>
    );
  }

  // Paste-a-key providers (API key or custom credentials).
  const meta = connectorMeta(p.id);
  const fields = p.credentialFields ?? ['apiKey'];
  const filled = fields.every((f) => (props.creds[f] ?? '').trim().length > 0);
  const hasHelp = (meta.setup?.length ?? 0) > 0 || !!meta.docsUrl;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (filled && !busy) props.onConnectDirect();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {hasHelp && (
        <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-2.5">
          {meta.setup && meta.setup.length > 0 && (
            <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-normal text-muted-foreground">
              {meta.setup.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          {meta.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
            >
              Get your {p.displayName} {p.method === 'api_key' ? 'API key' : 'credentials'}
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
        {fields.map((f) => (
          <div key={f} className="space-y-1">
            <label
              htmlFor={`cred-${p.id}-${f}`}
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {prettyField(f)}
            </label>
            <Input
              id={`cred-${p.id}-${f}`}
              type={SECRETY.test(f) ? 'password' : 'text'}
              autoComplete="off"
              value={props.creds[f] ?? ''}
              onChange={(e) => props.onCredChange(f, e.target.value)}
              placeholder={prettyField(f)}
              className="h-8 rounded-lg font-mono text-xs"
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-normal text-muted-foreground">
        Stored sealed in your home (<code className="rounded bg-muted px-1">.config/connectors</code>), never in the
        repo and never shown to the model.
      </p>
      <Button type="submit" size="sm" disabled={busy || !filled} className="text-xs font-semibold">
        <Plus size={14} /> Connect {p.displayName}
      </Button>
    </form>
  );
}

function Byo(props: ProviderDetailProps) {
  return (
    <ByoPanel
      provider={props.provider}
      redirectUri={props.redirectUri}
      copied={props.copied}
      onCopyRedirect={props.onCopyRedirect}
      configs={props.byoConfigs}
      form={props.byoForm}
      busy={props.busy}
      onField={props.onByoField}
      onAdd={props.onByoAdd}
      onConnect={(id) => props.onConnectOAuth(id)}
      onSetDefault={props.onByoSetDefault}
      onDelete={props.onByoDelete}
    />
  );
}

// ── Accounts ────────────────────────────────────────────────

function AccountRow({
  connection: c,
  busy,
  testing,
  result,
  onTest,
  onDisconnect,
}: {
  connection: Connection;
  busy: boolean;
  testing: boolean;
  result?: TestResult;
  onTest: () => void;
  onDisconnect: () => void;
}) {
  const scopes = c.scopes.length;
  return (
    // The identity keeps at least 12rem. On a narrow pane the actions wrap
    // beneath it rather than truncating the email down to a stub.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{connectionIdentity(c)}</span>
          <Chip tone={c.status === 'active' ? 'ok' : 'warn'}>{c.status}</Chip>
        </div>
        {(scopes > 0 || result) && (
          <p className="truncate text-[11px] text-muted-foreground">
            {scopes > 0 && `${scopes} scope${scopes === 1 ? '' : 's'}`}
            {result && (
              <span className={result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
                {scopes > 0 && ' · '}
                {result.ok ? '✓ Healthy' : `✗ ${result.error || result.status}`}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" onClick={onTest} disabled={busy || testing} className="text-xs">
          {testing ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
          Test
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={onDisconnect}
          disabled={busy}
          className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={12} /> Disconnect
        </Button>
      </div>
    </div>
  );
}

// ── Tools ───────────────────────────────────────────────────

/**
 * Every action agents can call through this provider, grouped by service. Writes
 * carry an "Ask first" switch: on pauses each call for approval, off lets it run
 * on the standing intent of having connected.
 */
function ToolList({
  toolkits,
  writePolicy,
  onSetApproval,
}: {
  toolkits: ToolkitInfo[];
  writePolicy: Record<string, WritePolicyAction>;
  onSetApproval: (actionId: string, mode: ApprovalMode) => void;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const total = toolkits.reduce((n, t) => n + t.actions.length, 0);
  const groups = toolkits
    .map((t) => ({
      toolkit: t,
      actions: t.actions.filter(
        (a) => !q || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.actions.length > 0);

  return (
    <section className="space-y-2">
      <GroupHeading
        count={total}
        action={
          total > TOOL_FILTER_THRESHOLD && (
            <div className="relative">
              <Search
                size={11}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tools"
                aria-label="Filter tools"
                className="h-7 w-44 rounded-lg pl-6 text-[11px]"
              />
            </div>
          )
        }
      >
        What agents can do
      </GroupHeading>
      <p className="text-[11px] leading-normal text-muted-foreground">
        Reads always run. Reversible writes run on their own once connected. Sends, posts, and deletes wait for your
        approval. Switch <span className="font-medium text-foreground/80">Ask first</span> on or off for any write.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card/20">
        {groups.map(({ toolkit: t, actions }) => (
          <div key={t.id} className="border-b border-border/60 py-1 last:border-b-0">
            {toolkits.length > 1 && (
              <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold text-foreground/70">{t.displayName}</div>
            )}
            {actions.map((a) => (
              <ToolRow key={a.id} action={a} policy={writePolicy[a.id]} onSetApproval={onSetApproval} />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-3 py-3 text-[11px] text-muted-foreground">No tools match “{filter}”.</p>
        )}
      </div>
    </section>
  );
}

function ToolRow({
  action: a,
  policy,
  onSetApproval,
}: {
  action: ActionInfo;
  policy?: WritePolicyAction;
  onSetApproval: (actionId: string, mode: ApprovalMode) => void;
}) {
  const gated = policy ? policy.mode === 'ask' : true; // gated until the policy loads
  return (
    <div className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/30">
      <span
        className={cn(
          'w-10 shrink-0 rounded px-1 py-0.5 text-center text-[8px] font-semibold uppercase',
          a.mutating ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
        )}
      >
        {a.mutating ? 'Write' : 'Read'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11px] text-foreground" title={a.id}>
          {a.id}
        </div>
        {a.description && (
          <div className="truncate text-[10px] text-muted-foreground" title={a.description}>
            {a.description}
          </div>
        )}
      </div>
      {a.mutating && (
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground"
          title="Require your approval before this action runs"
        >
          <span>
            Ask first
            {policy?.overridden && (
              <span className="text-foreground" title="Changed from the default">
                *
              </span>
            )}
          </span>
          <Switch
            size="sm"
            checked={gated}
            disabled={!policy}
            onCheckedChange={(on) => onSetApproval(a.id, on ? 'ask' : 'auto')}
            aria-label={`Ask before ${a.id} runs`}
          />
        </label>
      )}
    </div>
  );
}
