'use client';

/**
 * Detail + add views for remote MCP servers. An ingested server's tools become
 * integrations behind the same approval gate, so they get the same drill-in
 * treatment as a provider: status and controls up top, every tool listed below
 * with server-wide permissions and individual On and Ask first switches.
 */
import dynamic from 'next/dynamic';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, KeyRound, Loader2, LogIn, Plus, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PluginSetupHelpButton } from '@/components/plugins/setup-help-button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BackLink, Chip, DetailHeader, GroupHeading, McpLogo, type Tone } from './parts';
import type { McpForm, McpServerEntry } from './types';
import { describeMcpAuthDetection, detectedAuthKind, detectionFor, resolveMcpFormAuth, type McpAuthDetectionState, type McpAuthSummary } from './mcp-auth-detection';
import { DEFAULT_MCP_APPROVAL_POLICY, mcpToolApprovalOverride, resolveMcpToolApproval, type McpApprovalPolicy, type McpToolApprovalPatch } from '@/lib/integrations/mcp-approval-policy';
import { McpPermissionControls, McpPermissionSelect, MCP_POLICY_LABELS } from './mcp-permissions';
import { CapabilityReview } from './capability-review';
import { McpServerSettings } from './mcp-settings';
import { settingsCapability } from '@/lib/mcp-apps/metadata';
import { Tip } from '@/components/ui/tip';

// What the server's screens may reach on the network, which the page asks the Home once it shows in the browser.
const McpAppNetwork = dynamic(() => import('./mcp-app-network').then(module => module.McpAppNetwork), { ssr: false });

const AUTH_LABEL: Record<McpServerEntry['auth']['kind'], string> = {
  none: 'No auth',
  bearer: 'Bearer token',
  header: 'Custom header',
  oauth: 'OAuth',
};

/**
 * The MCP revision the last connection spoke, as a chip. Only the older
 * protocol gets a tooltip, since that is the case someone checking a
 * server's support needs explained.
 */
export function mcpProtocolChip(protocol: McpServerEntry['protocol']): { label: string; tip?: string } | null {
  if (!protocol?.version) return null;
  const label = `MCP ${protocol.version}`;
  if (protocol.era !== 'legacy') return { label };
  return { label, tip: 'This server answers only an older MCP version. Ri uses it automatically and tries the newest version again each day.' };
}

/** Health tone for a server: disabled reads as off regardless of the last probe. */
export function mcpTone(s: McpServerEntry): { tone: Tone; label: string } {
  if (!s.enabled) return { tone: 'off', label: 'Off' };
  if (s.lastStatus === 'ok') return { tone: 'ok', label: 'Connected' };
  if (s.lastStatus === 'unreachable') return { tone: 'warn', label: 'Unreachable' };
  if (s.lastStatus === 'error') return { tone: 'error', label: 'Error' };
  return { tone: 'off', label: 'Pending' };
}

export function McpServerDetail({
  server: s,
  busy,
  onBack,
  onAuthorize,
  onRetest,
  onToggleEnabled,
  onRemove,
  onToolOverride,
  onReviewCapabilities,
  defaultPolicy = DEFAULT_MCP_APPROVAL_POLICY,
  onSetPolicy,
}: {
  server: McpServerEntry;
  busy: boolean;
  onBack: () => void;
  onAuthorize: () => void;
  onRetest: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onToolOverride: (toolName: string, patch: McpToolApprovalPatch) => void;
  onReviewCapabilities?: (revision: string) => void;
  defaultPolicy?: McpApprovalPolicy;
  onSetPolicy?: (policy: McpApprovalPolicy | null) => void;
}) {
  const status = mcpTone(s);
  const tools = s.tools ?? [];
  const toolCount = s.lastToolCount ?? tools.length;
  const needsSignIn = s.auth.kind === 'oauth' && s.lastStatus !== 'ok';
  const protocol = mcpProtocolChip(s.protocol);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={onBack} busy={busy} label="All MCP servers" />
        <DetailHeader
          logo={<McpLogo size={48} dim={!s.enabled} />}
          title={s.displayName}
          subtitle={<span className="break-all font-mono text-[11px]">{s.url}</span>}
          meta={
            <>
              <Chip tone={status.tone}>{status.label}</Chip>
              <Chip>{AUTH_LABEL[s.auth.kind]}</Chip>
              <Chip>
                {toolCount} tool{toolCount === 1 ? '' : 's'}
              </Chip>
              {protocol && (protocol.tip
                ? <Tip label={protocol.tip}><span><Chip>{protocol.label}</Chip></span></Tip>
                : <Chip>{protocol.label}</Chip>)}
            </>
          }
          actions={
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              {s.enabled ? 'On' : 'Off'}
              <Switch
                checked={s.enabled}
                disabled={busy}
                onCheckedChange={onToggleEnabled}
                aria-label={s.enabled ? `Turn off ${s.displayName}` : `Turn on ${s.displayName}`}
              />
            </label>
          }
        />
        {s.lastStatus && s.lastStatus !== 'ok' && s.lastError && (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] leading-normal text-amber-600 dark:text-amber-400">
            {s.lastError}
          </p>
        )}
        {s.lastCheckedAt && <p className="text-[11px] text-muted-foreground">Last checked <time dateTime={s.lastCheckedAt} suppressHydrationWarning>{new Date(s.lastCheckedAt).toLocaleString()}</time></p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {needsSignIn && (
            <Button size="xs" onClick={onAuthorize} disabled={busy} className="text-xs font-semibold">
              <LogIn size={12} /> Sign in
            </Button>
          )}
          <Button variant="outline" size="xs" onClick={onRetest} disabled={busy} className="text-xs">
            <RefreshCw size={12} /> Re-test
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={onRemove}
            disabled={busy}
            className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={12} /> Remove server
          </Button>
        </div>
      </div>

      <CapabilityReview changes={s.capabilityChanges} busy={busy} onReview={onReviewCapabilities} />

      {onSetPolicy && <section aria-label={`Server permissions for ${s.displayName}`} className="@container space-y-3 rounded-xl border border-border bg-card/20 p-4">
        <h3 className="break-words text-xs font-medium">Permissions for {s.displayName}</h3>
        <McpPermissionControls label={`Permission choice and bulk action for ${s.displayName}`}>
          <McpPermissionSelect value={s.approvalPolicy ?? null} inheritedLabel="Use global default"
            label={`Permissions for ${s.displayName}`} busy={busy} onChange={onSetPolicy} />
          {Object.values(s.toolOverrides ?? {}).some(override => mcpToolApprovalOverride(override) !== undefined) &&
            <Button variant="outline" size="sm" className="h-9 text-xs" disabled={busy} onClick={() => onSetPolicy(s.approvalPolicy ?? null)}>Apply to all tools</Button>}
        </McpPermissionControls>
        <p className="text-[11px] leading-normal text-muted-foreground">
          {s.approvalPolicy == null && <>Global default: {MCP_POLICY_LABELS[defaultPolicy]}. </>}
          Changing this applies immediately to this server&apos;s tools, including new tools, and clears individual approval choices. Disabled tools stay off.
        </p>
      </section>}

      <McpServerSettings serverId={s.id} name={s.displayName} enabled={s.enabled && s.lastStatus === 'ok' && !!settingsCapability(s.protocol?.extensions)} />

      <McpAppNetwork serverId={s.id} name={s.displayName} enabled={s.enabled && s.lastStatus === 'ok'} />

      <PluginSetupHelpButton target={{ kind: 'mcp', server: s }} disabled={busy} />

      {tools.length > 0 && (
        <section className="space-y-2">
          <GroupHeading count={tools.length}>Tools</GroupHeading>
          <p className="text-[11px] leading-normal text-muted-foreground">
            Turn off tools agents should never call. Ask first pauses each call for approval. Individual switches override the server setting.
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-card/20 py-1">
            <div className="grid grid-cols-[1fr_2.5rem_3.5rem_1.25rem] items-center gap-x-2 px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Tool</span>
              <span className="text-center">On</span>
              <span className="text-center">Ask first</span>
              <span />
            </div>
            {tools.map((t) => {
              const ov = s.toolOverrides?.[t.name];
              const toolEnabled = ov?.enabled !== false;
              const gated = resolveMcpToolApproval(s, t.name, defaultPolicy, t.readOnlyHint !== true) === 'ask';
              return (
                <div
                  key={t.name}
                  className="grid grid-cols-[1fr_2.5rem_3.5rem_1.25rem] items-center gap-x-2 px-3 py-1.5 hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <Tip label={t.name} onlyWhenTextHidden>
                      <div className="truncate font-mono text-[11px] text-foreground">
                        {t.name}
                      </div>
                    </Tip>
                    {t.description && (
                      <Tip label={t.description} onlyWhenTextHidden>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {t.description}
                        </div>
                      </Tip>
                    )}
                  </div>
                  <Switch
                    size="sm"
                    checked={toolEnabled}
                    disabled={busy}
                    onCheckedChange={(on) => onToolOverride(t.name, { enabled: on })}
                    aria-label={`Enable ${t.name}`}
                    className="justify-self-center"
                  />
                  <Switch
                    size="sm"
                    checked={gated}
                    disabled={busy || !toolEnabled}
                    onCheckedChange={(on) => onToolOverride(t.name, { approvalMode: on ? 'ask' : 'auto' })}
                    aria-label={`Ask before ${t.name} runs`}
                    className="justify-self-center"
                  />
                  {mcpToolApprovalOverride(ov) !== undefined && <Tip label="Use server permissions">
                    <button type="button" aria-label={`Use server permissions for ${t.name}`} disabled={busy}
                      onClick={() => onToolOverride(t.name, { approvalMode: null })}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-50"><RotateCcw size={12} /></button>
                  </Tip>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Add a remote MCP server: name, URL, and how it authenticates. The method is
 * worked out from the URL (`useMcpAuthDetection`) and shown as a verdict with
 * a quiet way to change it. The full choice appears only when the probe has
 * nothing to go on or the person asks for it.
 */
export function McpServerForm({
  form,
  detection,
  busy,
  onChange,
  onSubmit,
  onBack,
}: {
  form: McpForm;
  /** The probe's verdict for the typed URL. */
  detection: McpAuthDetectionState;
  busy: boolean;
  onChange: (patch: Partial<McpForm>) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const url = form.url.trim();
  const detected = detectionFor(detection, url);
  const detectedKind = detected ? detectedAuthKind(detected) : null;
  const { authKind, header } = resolveMcpFormAuth(form, detected);
  // Change opens the full choice for this address only. A new address closes it again.
  const [changingFor, setChangingFor] = useState<string | null>(null);
  const choosing = !!url && ((detected !== null && detectedKind === null) || form.authChosen || changingFor === url);
  const headerHint = detected?.method === 'key' ? detected.header : undefined;
  const usesSecret = authKind === 'bearer' || authKind === 'header';
  const ready =
    !!form.name.trim() &&
    !!url &&
    (!usesSecret || !!form.secret) &&
    (authKind !== 'header' || !!header);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && !busy) onSubmit();
  };
  const choose = (kind: McpForm['authKind']) => onChange({ authKind: kind, authChosen: true });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={onBack} busy={busy} label="All MCP servers" />
        <DetailHeader
          logo={<McpLogo size={48} />}
          title="Add an MCP server"
          subtitle="Connect a remote MCP server. Its tools follow your default MCP permissions."
        />
      </div>

      <PluginSetupHelpButton target={{ kind: 'mcp-new', form: { ...form, authKind, header } }} disabled={busy} />

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card/20 p-4">
        <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
          <Field label="Name" htmlFor="mcp-name">
            <Input
              id="mcp-name"
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Sentry"
              className="h-8 rounded-lg text-xs"
              autoFocus
            />
          </Field>
          <Field label="Server URL" htmlFor="mcp-url">
            <Input
              id="mcp-url"
              value={form.url}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://mcp.example.com"
              className="h-8 rounded-lg font-mono text-xs"
            />
          </Field>
          <div className="@lg:col-span-2">
            <McpAuthVerdict detection={detection} url={url} busy={busy} choosing={choosing}
              onChange={() => setChangingFor(url)} onUseKey={() => choose('bearer')} />
          </div>
          {choosing && (
            <Field label="Auth" htmlFor="mcp-auth">
              <select
                id="mcp-auth"
                value={authKind}
                disabled={busy}
                onChange={(e) => choose(e.target.value as McpForm['authKind'])}
                className="h-8 w-full rounded-lg border border-border bg-input/30 px-2 text-xs text-foreground"
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="header">Custom header</option>
                <option value="oauth">OAuth (sign in)</option>
              </select>
            </Field>
          )}
          {authKind === 'header' && (
            <Field label="Header name" htmlFor="mcp-header">
              <Input
                id="mcp-header"
                value={form.header}
                onChange={(e) => onChange({ header: e.target.value })}
                placeholder={headerHint ?? 'X-API-Key'}
                className="h-8 rounded-lg font-mono text-xs"
              />
            </Field>
          )}
          {usesSecret && (
            <Field label="Secret" htmlFor="mcp-secret" wide>
              <Input
                id="mcp-secret"
                type="password"
                autoComplete="off"
                value={form.secret}
                onChange={(e) => onChange({ secret: e.target.value })}
                placeholder="Token or key"
                className="h-8 rounded-lg font-mono text-xs"
              />
            </Field>
          )}
        </div>
        {authKind === 'oauth' && detected?.method !== 'oauth' && (
          <p className="rounded-lg border border-border/50 bg-muted/30 p-2.5 text-[11px] leading-normal text-muted-foreground">
            You&apos;ll be redirected to sign in. We register a client automatically (no secret to paste) and store the
            tokens sealed in your home, refreshed for you.
          </p>
        )}
        <p className="text-[11px] leading-normal text-muted-foreground">
          {usesSecret && 'The secret is sealed in your home and never shown to the model. '}
          If an agent session is already running, restart it to use newly added tools.
        </p>
        <Button type="submit" size="sm" disabled={busy || !ready} className="text-xs font-semibold">
          <Plus size={14} /> {authKind === 'oauth' ? 'Add and sign in' : 'Add and connect'}
        </Button>
      </form>
    </div>
  );
}

const VERDICT_ICON: Record<McpAuthSummary['tone'], typeof ShieldCheck> = { ok: ShieldCheck, warn: AlertCircle };
const METHOD_ICON = { none: ShieldCheck, oauth: LogIn, key: KeyRound } as const;

/**
 * What the probe found for the typed address, with the one quiet control that
 * covers the exceptions: a server that also takes a key (DataForSEO does) or a
 * verdict the person knows better than.
 */
function McpAuthVerdict({ detection, url, busy, choosing, onChange, onUseKey }: {
  detection: McpAuthDetectionState;
  url: string;
  busy: boolean;
  choosing: boolean;
  onChange: () => void;
  onUseKey: () => void;
}) {
  if (!url) return <p className="text-[11px] leading-normal text-muted-foreground">Enter the server URL and Ri works out how it authenticates.</p>;
  const detected = detectionFor(detection, url);
  const quiet = 'h-auto px-1.5 py-0.5 text-[11px] font-medium';
  if (!detected) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-normal text-muted-foreground">
        <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden />
        <span>Checking how this server authenticates…</span>
        {!choosing && <Button type="button" variant="ghost" size="xs" className={quiet} disabled={busy} onClick={onChange}>Choose instead</Button>}
      </div>
    );
  }
  const summary = describeMcpAuthDetection(detected);
  const Icon = detected.method === 'unknown' ? VERDICT_ICON[summary.tone] : METHOD_ICON[detected.method];
  const tone = summary.tone === 'ok' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border p-2.5 text-[11px] leading-normal ${tone}`}>
      <Icon size={14} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p><span className="font-semibold">{summary.title}.</span> {summary.detail}</p>
        {(detected.method === 'oauth' || (detected.method !== 'unknown' && !choosing)) && (
          <div className="flex flex-wrap gap-1">
            {detected.method === 'oauth' && <Button type="button" variant="outline" size="xs" className={`${quiet} bg-background/60`} disabled={busy} onClick={onUseKey}>Use an API key instead</Button>}
            {!choosing && <Button type="button" variant="ghost" size="xs" className={quiet} disabled={busy} onClick={onChange}>Change</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'space-y-1 @lg:col-span-2' : 'space-y-1'}>
      <label htmlFor={htmlFor} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
