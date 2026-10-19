'use client';

import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { openSettings } from '@/components/settings/settings-store';
import { Checkbox } from '@/components/ui/checkbox';
import { useConnectionCardAction, useIntegrationStatus, useSaveSignInApp } from '@/hooks/use-connection-requests';
import { useSessionEvents } from '@/hooks/use-execution';
import { apiErrorText } from '@/lib/api/client';
import type { ChatEventRecord } from '@/lib/api/dto/records';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import {
	DEVELOPER_CONSOLES,
	describeAccounts,
	looksLikeEmail,
	type ConnectionRequestView,
	type ConnectionResponseView,
} from '@/lib/integrations/connection-catalog';
import { cn } from '@/lib/utils';
import { Bot, Check, Copy, ExternalLink, KeyRound, Loader2, Plug, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Tip } from '@/components/ui/tip';
import { sourceErrorMessage, useConnectAttempt, useConnectionMethod } from '@/hooks/use-integration-sources';
import { applicationForDirectToolkit, parseManagedToolkitId } from '@/lib/integrations/sources/applications';
import type { ApplicationId } from '@/lib/integrations/sources/types';
import { trpcClient } from '@/lib/trpc/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';


/** The card a sign-in started from, so its result (or error) shows on it when the page returns. */
const PENDING_SIGN_IN_KEY = 'ri.connectCard.signIn';

function asView(event: ChatEventRecord): ConnectionRequestView | null {
  const v = event.toolInput as Partial<ConnectionRequestView> | null;
  return v && typeof v.providerId === 'string' && typeof v.kind === 'string' ? (v as ConnectionRequestView) : null;
}

/** The recorded answer to a Connect card, if any, from the chat's `connection_response` rows. */
function useCardResponse(sessionId: string | undefined, eventId: string): ConnectionResponseView | null {
  const { data: events } = useSessionEvents(sessionId ?? null);
  return useMemo(() => {
    for (const e of events ?? []) {
      if (e.source !== 'connection_response') continue;
      const r = e.toolInput as Partial<ConnectionResponseView> | null;
      if (r?.requestEventId === eventId) return r as ConnectionResponseView;
    }
    return null;
  }, [events, eventId]);
}

/** The result of a sign-in this card started, when the page has just come back from it. */
function signInReturn(eventId: string): { notice: string | null } | null {
  if (typeof window === 'undefined' || sessionStorage.getItem(PENDING_SIGN_IN_KEY) !== eventId) return null;
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (!error && !params.get('connected')) return null;
  if (!error) return { notice: null };
  return { notice: error === 'authorization_cancelled' ? 'Sign-in was cancelled.' : `Sign-in didn’t finish (${error}). Try again.` };
}

/** Where the provider's sign-in should land back: this page, minus a previous result. */
function currentReturnPath(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('connected');
  url.searchParams.delete('error');
  url.searchParams.delete('attempt');
  return `${url.pathname}${url.search}`;
}

/**
 * A Connect card in chat: an agent asked for a service it needs, or a connection stopped working.
 * The server wrote it (lib/integrations/connection-requests.ts). What the card offers follows the
 * provider's live state: a one-click sign-in, a one-time sign-in app setup, or a key field. Keys
 * and app secrets go straight to the encrypted store, never into the chat or to the agent.
 */
export function ConnectionRequestCard({ event, sessionId }: { event: ChatEventRecord; sessionId?: string }) {
  const view = asView(event);
  const response = useCardResponse(sessionId, event.id);
  const { data: status } = useIntegrationStatus(!!view && !response);
  const action = useConnectionCardAction(event.id);
  // A sign-in this card started came back with an error: say so here.
  const [notice, setNotice] = useState<string | null>(() => signInReturn(event.id)?.notice ?? null);
  // A managed account's reconnect: polled until it settles, which also finishes it when the
  // source's redirect can't reach this home. Its completion answers the card on the server.
  const [managedAttemptId, setManagedAttemptId] = useState<string | null>(null);
  const managedAttempt = useConnectAttempt(response ? null : managedAttemptId);

  // ...and once shown, tidy the result off the URL.
  useEffect(() => {
    if (!signInReturn(event.id)) return;
    sessionStorage.removeItem(PENDING_SIGN_IN_KEY);
    window.history.replaceState(null, '', currentReturnPath());
  }, [event.id]);

  if (!view) return null;
  const provider = status?.providers.find((p) => p.id === view.providerId);
  const busy = action.isPending;
  // Gmail or Google Calendar asked for: it may connect through a managed source (Composio).
  const apps = view.kind === 'connect' && view.method === 'oauth2' ? [...new Set(view.toolkitIds.map(applicationForDirectToolkit))] : [];
  const managedApp = apps.length === 1 ? apps[0] : undefined;

  const run = (body: Parameters<typeof action.mutate>[0], after?: (r: Awaited<ReturnType<typeof action.mutateAsync>>) => void) => {
    setNotice(null);
    action.mutate(body, {
      onSuccess: (result) => after?.(result),
      onError: (err) => toast.error(apiErrorText(err)),
    });
  };

  const signIn = () =>
    run({ action: 'sign_in', returnTo: currentReturnPath() }, async (result) => {
      if ('done' in result) return;
      if (parseManagedToolkitId(view.providerId)) setManagedAttemptId(result.requestId);
      sessionStorage.setItem(PENDING_SIGN_IN_KEY, event.id);
      await openIntegrationAuthorization(result.authorizationUrl);
      // The desktop app signs in in the system browser: the page stays here until the card updates.
      if (result.desktopFlowId) setNotice('Finish signing in in your browser.');
    });

  const resolved = response !== null;
  const reconnectState = managedAttemptId ? managedAttempt.data : undefined;
  const reconnectNotice = !reconnectState ? null
    : reconnectState.status === 'pending' ? 'Finish signing in in your browser.'
      : reconnectState.status === 'completed' ? null : reconnectState.error;
  const title = cardTitle(view);
  const offered = view.accounts ?? [];
  const subtitle = [
    view.label !== view.providerName ? view.providerName : null,
    // A single account is named here. Several are listed below, to choose from.
    offered.length === 1 ? offered[0]!.label : view.kind === 'allow_agent' ? null : view.account,
    view.agent ? `for the ${view.agent.name} agent` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card text-[11px]', resolved ? 'border-border' : 'border-sky-500/40')}>
      <div className={cn('flex items-center gap-2.5 border-b px-3 py-2', resolved ? 'border-border/60 bg-muted/20' : 'border-sky-500/20 bg-sky-500/5')}>
        <IntegrationLogo providerId={logoFor(view.providerId)} name={view.providerName} size={24} className="rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <KindIcon kind={view.kind} />
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">{title}</span>
          </div>
          {subtitle && <div className="truncate text-[10.5px] text-muted-foreground">{subtitle}</div>}
        </div>
      </div>

      <div className="px-3 py-2 text-muted-foreground">
        {view.reason ? (
          <p>
            <span className="text-muted-foreground/70">The agent says: </span>
            <span className="italic text-foreground/85">“{view.reason}”</span>
          </p>
        ) : (
          <p>{appExplanation(view)}</p>
        )}
        {view.kind === 'connect' && view.requestedAccount && !resolved && (
          <p className="mt-1 text-foreground/85">
            {looksLikeEmail(view.requestedAccount) ? `Sign in as ${view.requestedAccount}.` : `Sign in with your ${view.requestedAccount} account.`}
          </p>
        )}
      </div>

      {resolved ? (
        <ResolvedFooter response={response} view={view} />
      ) : view.kind === 'allow_agent' ? (
        <AllowForAgent
          view={view}
          busy={busy}
          notice={notice}
          onDecline={() => run({ action: 'decline' })}
          onAllow={(accounts) => run({ action: 'allow', accounts })}
        />
      ) : view.method === 'mcp' ? (
        <Footer busy={busy} onDecline={() => run({ action: 'decline' })} notice={notice}>
          <PrimaryButton busy={busy} onClick={() => openSettings('plugins')}>
            Connect in Settings
          </PrimaryButton>
        </Footer>
      ) : view.method !== 'oauth2' ? (
        <KeyForm view={view} busy={busy} notice={notice} onDecline={() => run({ action: 'decline' })} onSubmit={(fields) => run({ action: 'key', fields })} />
      ) : !status ? (
        <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-muted-foreground">
          <Loader2 size={11} className="animate-spin" /> Checking {view.providerName}…
        </div>
      ) : managedApp ? (
        <ManagedConnect
          applicationId={managedApp}
          eventId={event.id}
          view={view}
          busy={busy}
          notice={notice}
          onDecline={() => run({ action: 'decline' })}
          renderDirect={(beforeSignIn) => {
            const directSignIn = () => void beforeSignIn().then(signIn, (err: unknown) => toast.error(sourceErrorMessage(err)));
            return provider && !provider.configured ? (
              <SetupForm
                view={view}
                provider={provider}
                redirectUri={status.redirectUri}
                busy={busy}
                notice={notice}
                onDecline={() => run({ action: 'decline' })}
                onSaved={directSignIn}
              />
            ) : (
              <Footer busy={busy} onDecline={() => run({ action: 'decline' })} notice={notice}>
                <PrimaryButton busy={busy} onClick={directSignIn}>Connect {view.providerName}</PrimaryButton>
              </Footer>
            );
          }}
        />
      ) : provider && !provider.configured && view.kind === 'connect' ? (
        <SetupForm
          view={view}
          provider={provider}
          redirectUri={status.redirectUri}
          busy={busy}
          notice={notice}
          onDecline={() => run({ action: 'decline' })}
          onSaved={signIn}
        />
      ) : (
        <Footer busy={busy} onDecline={() => run({ action: 'decline' })} notice={reconnectNotice ?? notice}>
          <PrimaryButton busy={busy || reconnectState?.status === 'pending'} onClick={signIn}>
            {view.kind === 'reconnect' ? `Reconnect ${view.providerName}` : view.kind === 'more_access' ? 'Allow access' : `Connect ${view.providerName}`}
          </PrimaryButton>
        </Footer>
      )}
    </div>
  );
}

/** A managed provider (Gmail through Composio) wears its application's mark. */
function logoFor(providerId: string): string {
  const managed = parseManagedToolkitId(providerId);
  return managed ? (managed.applicationId === 'gmail' ? 'gmail' : 'google') : providerId;
}

/**
 * Connect through the method Ri chose for this application. With a managed source preferred the
 * card signs in through it, and the attempt (callback or polling) answers the card, granting the
 * asking agent exactly the new account. "Change method" switches to the direct sign-in, and the
 * choice is remembered for the application once the person connects that way, as in Settings.
 */
function ManagedConnect({ applicationId, eventId, view, busy, notice, onDecline, renderDirect }: {
  applicationId: ApplicationId;
  eventId: string;
  view: ConnectionRequestView;
  busy: boolean;
  notice: string | null;
  onDecline: () => void;
  /** The direct sign-in, given what to do just before it starts. */
  renderDirect: (beforeSignIn: () => Promise<void>) => ReactNode;
}) {
  const method = useConnectionMethod(applicationId, 'agent_tools');
  const [mode, setMode] = useState<'auto' | 'direct' | 'managed'>('auto');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [calendarUse, setCalendarUse] = useState(true);
  const [starting, setStarting] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useConnectAttempt(attemptId);
  const selection = method.data;
  const options = selection ? [selection.primary, ...selection.alternatives] : [];
  const managedOptions = options.filter((o): o is Extract<NonNullable<typeof o>, { kind: 'managed' }> => o?.kind === 'managed' && o.available);
  const directOption = options.find((o): o is Extract<NonNullable<typeof o>, { kind: 'direct' }> => o?.kind === 'direct');
  const primaryManaged = selection?.primary?.kind === 'managed' && selection.primary.available ? selection.primary : null;
  const chosen = managedOptions.find(o => o.source.id === sourceId) ?? primaryManaged ?? managedOptions[0] ?? null;
  const attemptState = attempt.data;
  const failed = attemptState && attemptState.status !== 'pending' && attemptState.status !== 'completed' ? attemptState.error : null;

  if (method.isLoading) {
    return <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-muted-foreground"><Loader2 size={11} className="animate-spin" /> Checking how to connect…</div>;
  }

  const showDirect = !chosen || mode === 'direct' || (mode === 'auto' && !primaryManaged);
  if (showDirect) {
    // Picking the direct route over another recommendation is an explicit choice: remember it.
    const beforeSignIn = async () => {
      if (!directOption || selection?.primary?.kind === 'direct' || 'sourceId' in directOption.method) return;
      await trpcClient.integrationSources.setApplicationMethod.mutate({ applicationId, method: directOption.method });
    };
    return (
      <>
        {chosen && (
          <div className="flex flex-wrap items-center gap-x-2 border-t border-border px-3 pt-2 text-[10.5px] text-muted-foreground">
            <span>Using a direct sign-in with your Google OAuth app.</span>
            <button type="button" onClick={() => setMode('managed')} className="underline underline-offset-2 hover:text-foreground">
              Use {chosen.source.label} instead
            </button>
          </div>
        )}
        {renderDirect(beforeSignIn)}
      </>
    );
  }

  const explicitChoice = !(selection?.primary?.kind === 'managed' && selection.primary.source.id === chosen.source.id);
  const connect = async () => {
    setMessage(null);
    setStarting(true);
    try {
      const result = await trpcClient.integrationSources.cardSignIn.mutate({
        eventId, returnTo: currentReturnPath(), sourceId: chosen.source.id,
        ...(explicitChoice ? { explicitChoice: true } : {}),
        ...(applicationId === 'google_calendar' ? { calendarUse } : {}),
      });
      sessionStorage.setItem(PENDING_SIGN_IN_KEY, eventId);
      setAttemptId(result.attemptId);
      await openIntegrationAuthorization(result.authorizationUrl);
    } catch (error) {
      setMessage(sourceErrorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2">
      <p className="mb-1.5 text-muted-foreground">
        Using {chosen.source.label}{selection?.basis === 'preferred' && chosen === selection.primary ? ', your preferred source' : ''}. {chosen.source.label} stores this connection and processes its tool requests.
      </p>
      {applicationId === 'google_calendar' && (
        <label className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-foreground/85">
          <Checkbox checked={calendarUse} onCheckedChange={(value) => setCalendarUse(value === true)} aria-label="Show in Ri's Calendar and deck" />
          Show in Ri&apos;s Calendar and deck
        </label>
      )}
      {attemptId && attemptState?.status === 'pending' && <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground"><Loader2 size={10} className="animate-spin" /> Finish signing in in your browser.</p>}
      {(failed || message || notice) && <p className="mb-1.5 text-[10.5px] text-amber-600 dark:text-amber-400">{failed ?? message ?? notice}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || starting} onClick={onDecline} className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50">
          Not now
        </button>
        {directOption && (
          <button type="button" onClick={() => setMode('direct')} className="text-[10.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Change method
          </button>
        )}
        {managedOptions.length > 1 && (
          <Select value={chosen.source.id} onValueChange={setSourceId}>
            <SelectTrigger size="sm" aria-label="Source" className="h-6 text-[10.5px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {managedOptions.map(o => <SelectItem key={o.source.id} value={o.source.id} className="text-xs">{o.source.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        <PrimaryButton busy={starting} onClick={() => void connect()}>Connect {view.label}</PrimaryButton>
      </div>
    </div>
  );
}

function cardTitle(view: ConnectionRequestView): string {
  switch (view.kind) {
    case 'reconnect':
      return `Reconnect ${view.label}`;
    case 'more_access':
      return `${view.label} needs more access`;
    case 'allow_agent':
      return `Let ${view.agent?.name ?? 'this agent'} use ${view.label}`;
    default:
      return `Connect ${view.label}`;
  }
}

function appExplanation(view: ConnectionRequestView): string {
  switch (view.kind) {
    case 'reconnect':
      return view.method === 'mcp'
        ? `${view.label} stopped working, so the last action didn’t run. Sign in again in Settings, under Plugins, and the agent will retry.`
        : view.method === 'oauth2'
          ? `${view.account ?? view.label} stopped working, so the last action didn’t run. Sign in again and the agent will retry.`
          : `The ${view.label} key stopped working, so the last action didn’t run. Enter it again and the agent will retry.`;
    case 'more_access':
      return `The last action needs access ${view.account ?? 'this account'} hasn’t granted yet. Allow it and the agent will retry.`;
    case 'allow_agent':
      return `${view.label} is connected, but this agent can’t use it yet.`;
    default:
      return `A tool needs ${view.label}, which isn’t connected.`;
  }
}

function KindIcon({ kind }: { kind: ConnectionRequestView['kind'] }) {
  const cls = 'shrink-0 text-sky-500';
  if (kind === 'reconnect') return <RefreshCw size={11} className={cls} />;
  if (kind === 'more_access') return <ShieldCheck size={11} className={cls} />;
  if (kind === 'allow_agent') return <Bot size={11} className={cls} />;
  return <Plug size={11} className={cls} />;
}

function PrimaryButton({ busy, onClick, children, type = 'button', disabled }: { busy: boolean; onClick?: () => void; children: ReactNode; type?: 'button' | 'submit'; disabled?: boolean }) {
  return (
    <button
      type={type}
      disabled={busy || disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <Loader2 size={11} className="animate-spin" />}
      {children}
    </button>
  );
}

function Footer({ busy, onDecline, notice, children }: { busy: boolean; onDecline: () => void; notice: string | null; children: ReactNode }) {
  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2">
      {notice && <p className="mb-1.5 text-[10.5px] text-amber-600 dark:text-amber-400">{notice}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50"
        >
          Not now
        </button>
        <div className="flex-1" />
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, secret }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] focus:border-primary/50 focus:outline-none"
      />
    </label>
  );
}

function fieldLabel(field: string): string {
  const words = field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return words.replace(/\bapi\b/g, 'API').replace(/\bid\b/g, 'ID').replace(/^./, (c) => c.toUpperCase());
}

/** An API-key provider: the key goes from this form straight to the encrypted store. */
function KeyForm({
  view,
  busy,
  notice,
  onDecline,
  onSubmit,
}: {
  view: ConnectionRequestView;
  busy: boolean;
  notice: string | null;
  onDecline: () => void;
  onSubmit: (fields: Record<string, string>) => void;
}) {
  const names = view.credentialFields.length > 0 ? view.credentialFields : ['token'];
  const [fields, setFields] = useState<Record<string, string>>({});
  const ready = names.every((n) => (fields[n] ?? '').trim() !== '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(fields);
      }}
    >
      <div className="space-y-1.5 border-t border-border/60 px-3 py-2">
        {names.map((n) => (
          <Field key={n} label={fieldLabel(n)} value={fields[n] ?? ''} onChange={(v) => setFields((f) => ({ ...f, [n]: v }))} secret={!/subdomain|email|phone_number_id|client_id/.test(n)} />
        ))}
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
          <KeyRound size={10} /> Saved encrypted on this computer. The agent never sees it.
        </p>
      </div>
      <Footer busy={busy} onDecline={onDecline} notice={notice}>
        <PrimaryButton busy={busy} type="submit" disabled={!ready}>
          {view.kind === 'reconnect' ? 'Reconnect' : 'Connect'} {view.providerName}
        </PrimaryButton>
      </Footer>
    </form>
  );
}

/**
 * A sign-in provider with no app set up yet: register one at the provider, paste its client ID
 * and secret here, then sign in. Saved exactly as Settings saves it (the same store and route).
 */
function SetupForm({
  view,
  provider,
  redirectUri,
  busy,
  notice,
  onDecline,
  onSaved,
}: {
  view: ConnectionRequestView;
  provider: { id: string; displayName: string; desktopCallback?: { kind: 'loopback' | 'relay'; redirectUri?: string } };
  redirectUri: string;
  busy: boolean;
  notice: string | null;
  onDecline: () => void;
  onSaved: () => void;
}) {
  const save = useSaveSignInApp();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const callback = provider.desktopCallback;
  const shown = callback
    ? callback.kind === 'loopback'
      ? 'http://127.0.0.1:<temporary-port>/oauth/callback'
      : callback.redirectUri || 'Configure a hosted callback service first'
    : redirectUri;
  const saved = callback ? callback.redirectUri || 'http://127.0.0.1/oauth/callback' : redirectUri;
  const consoleUrl = DEVELOPER_CONSOLES[view.providerId];
  const working = busy || save.isPending;

  const submit = () =>
    save.mutate(
      {
        providerId: view.providerId,
        label: `My ${view.providerName} app`,
        oauth: { clientId: clientId.trim(), redirectUri: saved },
        clientSecret: clientSecret.trim() || undefined,
      },
      { onSuccess: onSaved, onError: (err) => toast.error(apiErrorText(err)) },
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (clientId.trim()) submit();
      }}
    >
      <div className="space-y-2 border-t border-border/60 px-3 py-2">
        <p className="text-foreground/85">
          {view.providerName} needs a one-time setup: a sign-in app of your own, so {view.providerName} knows it’s you connecting.
        </p>
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>
            Create an OAuth app{' '}
            {consoleUrl ? (
              <a href={consoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2">
                in {view.providerName}’s developer console <ExternalLink size={9} />
              </a>
            ) : (
              <>in {view.providerName}’s developer settings</>
            )}
            .
          </li>
          <li>
            Add this redirect URI:
            <span className="mt-0.5 flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground">{shown}</code>
              <Tip label="Copy redirect URI">
                <button
                  type="button"
                  aria-label="Copy redirect URI"
                  onClick={() => void navigator.clipboard.writeText(shown).then(() => toast.success('Copied'))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <Copy size={11} />
                </button>
              </Tip>
            </span>
          </li>
          <li>Paste its client ID and secret:</li>
        </ol>
        <Field label="Client ID" value={clientId} onChange={setClientId} />
        <Field label="Client secret" value={clientSecret} onChange={setClientSecret} secret />
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground/80">
          <KeyRound size={10} /> Saved encrypted on this computer. The agent never sees it.{' '}
          <button type="button" onClick={() => openSettings('plugins')} className="underline underline-offset-2">
            More options in Settings
          </button>
        </p>
      </div>
      <Footer busy={working} onDecline={onDecline} notice={notice}>
        <PrimaryButton busy={working} type="submit" disabled={!clientId.trim()}>
          Save and connect
        </PrimaryButton>
      </Footer>
    </form>
  );
}

/**
 * Allow an agent to use a connected service. With several accounts, the user checks exactly the
 * ones it may use: the one the agent named comes checked, and with none named nothing is, rather
 * than handing over every inbox at once. What's checked is what's granted, and what the card,
 * the answer and the agent's note all name.
 */
function AllowForAgent({
  view,
  busy,
  notice,
  onDecline,
  onAllow,
}: {
  view: ConnectionRequestView;
  busy: boolean;
  notice: string | null;
  onDecline: () => void;
  onAllow: (accounts: string[]) => void;
}) {
  const offered = view.accounts ?? [];
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(view.preselected ?? []));
  const choosing = offered.length > 1;
  const toggle = (accountId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  return (
    <>
      {choosing && (
        <fieldset className="space-y-1 border-t border-border/60 px-3 py-2">
          <legend className="sr-only">Accounts</legend>
          <p className="pb-0.5 text-muted-foreground">
            Which {view.providerName} accounts can {view.agent?.name ?? 'this agent'} use for {view.label}?
          </p>
          {offered.map((a) => (
            <label key={`${a.accountId}|${a.authConfigId ?? ''}`} className="flex cursor-pointer items-center gap-2 text-foreground/90">
              <Checkbox checked={checked.has(a.accountId)} disabled={busy} onCheckedChange={() => toggle(a.accountId)} />
              <span className="truncate">{a.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      <Footer busy={busy} onDecline={onDecline} notice={notice}>
        <PrimaryButton
          busy={busy}
          disabled={choosing && checked.size === 0}
          onClick={() => onAllow(choosing ? [...checked] : offered.map((a) => a.accountId))}
        >
          Allow for {view.agent?.name ?? 'this agent'}
        </PrimaryButton>
      </Footer>
    </>
  );
}

function ResolvedFooter({ response, view }: { response: ConnectionResponseView; view: ConnectionRequestView }) {
  const accounts = response.accounts ?? (response.account ? [response.account] : []);
  const on = accounts.length === 0 ? '' : ` on ${describeAccounts(accounts)}`;
  const who = view.onBehalf && view.agent ? `The ${view.agent.name} agent can use it now.` : 'The agent was told to continue.';
  const text =
    response.outcome === 'declined'
      ? 'Not now. The agent was told.'
      : response.outcome === 'allowed'
        ? `${view.agent?.name ?? 'The agent'} can use ${view.label}${on} now.${view.onBehalf ? '' : ' The agent was told to continue.'}`
        : `${view.kind === 'reconnect' ? 'Reconnected' : 'Connected'}${accounts.length ? ` as ${describeAccounts(accounts)}` : ''}. ${who}`;
  return (
    <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-1.5 text-muted-foreground">
      {response.outcome === 'declined' ? <X size={11} className="shrink-0" /> : <Check size={11} className="shrink-0 text-emerald-500" />}
      <span className="min-w-0 flex-1">{text}</span>
    </div>
  );
}
