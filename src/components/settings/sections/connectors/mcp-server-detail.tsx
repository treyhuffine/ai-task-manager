'use client';

/**
 * Detail + add views for remote MCP servers. An ingested server's tools become
 * connectors behind the same approval gate, so they get the same drill-in
 * treatment as a provider: status and controls up top, every tool listed below
 * with its On and Ask first switches, no dropdowns.
 */
import type { FormEvent, ReactNode } from 'react';
import { LogIn, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { BackLink, Chip, DetailHeader, GroupHeading, McpLogo, type Tone } from './parts';
import type { McpForm, McpServerEntry, McpToolOverride } from './types';

const AUTH_LABEL: Record<McpServerEntry['auth']['kind'], string> = {
  none: 'No auth',
  bearer: 'Bearer token',
  header: 'Custom header',
  oauth: 'OAuth',
};

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
}: {
  server: McpServerEntry;
  busy: boolean;
  onBack: () => void;
  onAuthorize: () => void;
  onRetest: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onToolOverride: (toolName: string, patch: McpToolOverride) => void;
}) {
  const status = mcpTone(s);
  const tools = s.tools ?? [];
  const toolCount = s.lastToolCount ?? tools.length;
  const needsSignIn = s.auth.kind === 'oauth' && s.lastStatus !== 'ok';

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={onBack} busy={busy} />
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

      {tools.length > 0 && (
        <section className="space-y-2">
          <GroupHeading count={tools.length}>Tools</GroupHeading>
          <p className="text-[11px] leading-normal text-muted-foreground">
            Turn off any tool agents should never call. Ask first pauses a tool for your approval each time, so switch
            it off only for trusted read-only tools. Restart a running agent session to pick up changes.
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-card/20 py-1">
            <div className="grid grid-cols-[1fr_2.5rem_3.5rem] items-center gap-x-2 px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Tool</span>
              <span className="text-center">On</span>
              <span className="text-center">Ask first</span>
            </div>
            {tools.map((t) => {
              const ov = s.toolOverrides?.[t.name];
              const toolEnabled = ov?.enabled !== false;
              const gated = ov?.mutating !== false;
              return (
                <div
                  key={t.name}
                  className="grid grid-cols-[1fr_2.5rem_3.5rem] items-center gap-x-2 px-3 py-1.5 hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-foreground" title={t.name}>
                      {t.name}
                    </div>
                    {t.description && (
                      <div className="truncate text-[10px] text-muted-foreground" title={t.description}>
                        {t.description}
                      </div>
                    )}
                  </div>
                  <Switch
                    size="sm"
                    checked={toolEnabled}
                    onCheckedChange={(on) => onToolOverride(t.name, { enabled: on })}
                    aria-label={`Enable ${t.name}`}
                    className="justify-self-center"
                  />
                  <Switch
                    size="sm"
                    checked={gated}
                    disabled={!toolEnabled}
                    onCheckedChange={(on) => onToolOverride(t.name, { mutating: on })}
                    aria-label={`Ask before ${t.name} runs`}
                    className="justify-self-center"
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** Add a remote MCP server: name, URL, and how it authenticates. */
export function McpServerForm({
  form,
  busy,
  onChange,
  onSubmit,
  onBack,
}: {
  form: McpForm;
  busy: boolean;
  onChange: (patch: Partial<McpForm>) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const usesSecret = form.authKind === 'bearer' || form.authKind === 'header';
  const ready =
    !!form.name.trim() &&
    !!form.url.trim() &&
    (!usesSecret || !!form.secret) &&
    (form.authKind !== 'header' || !!form.header.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && !busy) onSubmit();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={onBack} busy={busy} />
        <DetailHeader
          logo={<McpLogo size={48} />}
          title="Add an MCP server"
          subtitle="Point at any remote MCP server. Its tools become connectors, behind your approval gate."
        />
      </div>

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
          <Field label="Auth" htmlFor="mcp-auth">
            <select
              id="mcp-auth"
              value={form.authKind}
              onChange={(e) => onChange({ authKind: e.target.value as McpForm['authKind'] })}
              className="h-8 w-full rounded-lg border border-border bg-input/30 px-2 text-xs text-foreground"
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
              <option value="oauth">OAuth (sign in)</option>
            </select>
          </Field>
          {form.authKind === 'header' && (
            <Field label="Header name" htmlFor="mcp-header">
              <Input
                id="mcp-header"
                value={form.header}
                onChange={(e) => onChange({ header: e.target.value })}
                placeholder="X-API-Key"
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
        {form.authKind === 'oauth' && (
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
          <Plus size={14} /> {form.authKind === 'oauth' ? 'Add and sign in' : 'Add and connect'}
        </Button>
      </form>
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
