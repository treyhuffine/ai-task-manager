'use client';

/**
 * Detail + add views for remote MCP servers. An ingested server's tools become
 * integrations behind the same approval gate, so they get the same drill-in
 * treatment as a provider: status and controls up top, every tool listed below
 * with server-wide permissions and individual On and Ask first switches.
 */
import dynamic from 'next/dynamic';
import type { FormEvent, ReactNode } from 'react';
import { AlertCircle, Loader2, LogIn, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PluginSetupHelpButton } from '@/components/plugins/setup-help-button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BackLink, Chip, DetailHeader, GroupHeading, McpLogo, type Tone } from './parts';
import type { McpForm, McpServerEntry } from './types';
import { describeMcpAuthDetection, detectedAuthKind, detectionFor, resolveMcpFormAuth, type McpAuthDetectionState } from './mcp-auth-detection';
import { DEFAULT_MCP_APPROVAL_POLICY, mcpToolApprovalOverride, resolveMcpToolApproval, type McpApprovalPolicy, type McpToolApprovalPatch } from '@/lib/integrations/mcp-approval-policy';
import { McpPermissionControls, McpPermissionSelect, MCP_POLICY_LABELS } from './mcp-permissions';
import { CapabilityReview } from './capability-review';
import { McpServerSettings } from './mcp-settings';
import { settingsCapability } from '@/lib/mcp-apps/metadata';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';

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
 * Add a remote MCP server: name, URL, and how it authenticates. Once a URL is
 * typed, every method is one choice in a list. The probe (`useMcpAuthDetection`)
 * preselects the method it found and marks it Detected with what it saw, so
 * the finding reads first and changing it is one click on another method.
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
  const { authKind, header } = resolveMcpFormAuth(form, detected);
  // Nothing is chosen while the probe is still out, unless the person chose.
  const pending = !!url && !detected && !form.authChosen;
  const selected = pending ? null : authKind;
  const headerHint = detected?.method === 'key' ? detected.header : undefined;
  const usesSecret = selected === 'bearer' || selected === 'header';
  const ready =
    !!form.name.trim() &&
    !!url &&
    !!selected &&
    (!usesSecret || !!form.secret) &&
    (selected !== 'header' || !!header);
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
          <div className="pt-1 @lg:col-span-2">
            <McpAuthChoice detection={detection} url={url} selected={selected} busy={busy} onChoose={choose} />
          </div>
          {selected === 'header' && (
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
            <Field label="Secret" htmlFor="mcp-secret" wide={selected !== 'header'}>
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
        <p className="text-[11px] leading-normal text-muted-foreground">
          {usesSecret && 'The secret is sealed in your Ri and never shown to the model. '}
          If an agent session is already running, restart it to use newly added tools.
        </p>
        <Button type="submit" size="sm" disabled={busy || !ready} className="text-xs font-semibold">
          <Plus size={14} /> {selected === 'oauth' ? 'Add and sign in' : 'Add and connect'}
        </Button>
      </form>
    </div>
  );
}

/** Every method in a fixed order, so the list never moves when the probe answers. */
const MCP_AUTH_OPTIONS: readonly { kind: McpForm['authKind']; title: string; description: string }[] = [
  { kind: 'oauth', title: 'Sign in with your browser', description: 'Ri registers itself with the server (OAuth) and opens its sign-in page. There is no secret to paste, and Ri keeps the tokens sealed and refreshed.' },
  { kind: 'bearer', title: 'API key or token', description: 'Paste the key the server gave you. Ri sends it as a bearer token.' },
  { kind: 'header', title: 'API key in a custom header', description: 'For a server that reads its key from a header of its own, such as X-API-Key.' },
  { kind: 'none', title: 'No sign-in', description: 'For a server with open access.' },
];

/**
 * How the server authenticates, as one list of methods. The detected one
 * carries a Detected badge and the probe's own finding in place of the
 * generic description, in amber when sign-in may not work. A probe with
 * nothing to go on says why above the list and marks nothing.
 */
function McpAuthChoice({ detection, url, selected, busy, onChoose }: {
  detection: McpAuthDetectionState;
  url: string;
  selected: McpForm['authKind'] | null;
  busy: boolean;
  onChoose: (kind: McpForm['authKind']) => void;
}) {
  if (!url) return <p className="text-[11px] leading-normal text-muted-foreground">Enter the server URL and Ri works out how it authenticates.</p>;
  const detected = detectionFor(detection, url);
  const detectedKind = detected ? detectedAuthKind(detected) : null;
  const summary = detected ? describeMcpAuthDetection(detected) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1">
        <span id="mcp-auth-label" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Authentication</span>
        {!detected && (
          <span role="status" className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
            Checking how this server authenticates…
          </span>
        )}
      </div>
      {detected?.method === 'unknown' && summary && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] leading-normal text-amber-700 dark:text-amber-400">
          <AlertCircle size={14} className="mt-px shrink-0" aria-hidden />
          <span><span className="font-semibold">{summary.title}.</span> {summary.detail}</span>
        </p>
      )}
      <div role="radiogroup" aria-labelledby="mcp-auth-label" className="-mx-2 space-y-0.5">
        {MCP_AUTH_OPTIONS.map((option) => {
          const isDetected = option.kind === detectedKind;
          const warn = isDetected && summary?.tone === 'warn';
          return (
            <label
              key={option.kind}
              className={cn('flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors', busy ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40')}
            >
              <input
                type="radio"
                name="mcp-auth"
                value={option.kind}
                checked={selected === option.kind}
                disabled={busy}
                onChange={() => onChoose(option.kind)}
                className="mt-px size-3.5 shrink-0 appearance-none rounded-full border border-muted-foreground/50 transition-[border-color,border-width] checked:border-4 checked:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium leading-4 text-foreground">
                  {option.title}
                  {isDetected && <span className="rounded-full border border-border px-1.5 text-[10px] font-medium leading-4 text-muted-foreground">Detected</span>}
                </span>
                <span className={cn('mt-0.5 flex items-start gap-1 text-[11px] leading-normal', warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                  {warn && <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden />}
                  <span>{isDetected && summary ? summary.detail : option.description}</span>
                </span>
              </span>
            </label>
          );
        })}
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
