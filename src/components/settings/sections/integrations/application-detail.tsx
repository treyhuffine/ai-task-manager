'use client';

/**
 * One application's page in Connectors (docs/connector-service-spec.md §2), for applications a
 * managed source can connect: Gmail and Google Calendar.
 *
 *   Connect → browser consent → verify account → choose agent access
 *
 * Every account the application has is here, whichever way it was connected, labeled with its
 * source. One primary Connect uses the method Ri chose (the explicit choice for this application,
 * else the preferred source, else a working direct sign-in), and Change method keeps the rest in
 * reach. Disconnecting from Ri, revoking in Composio and removing one agent's access are three
 * different actions, and each says what it does.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bot, CalendarDays, Check, ChevronDown, ExternalLink, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tip';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { APPLICATIONS } from '@/lib/integrations/sources/applications';
import type { MethodOption } from '@/lib/integrations/sources/method-selection';
import type { ApplicationId } from '@/lib/integrations/sources/types';
import type { ManagedAccountView } from '@/lib/integrations/sources/views';
import { pinKey, scopePins } from '@/lib/integrations/scope-pins';
import type { WorkspaceIntegrationScope } from '@/db/types';
import {
  sourceErrorMessage, useConnectAttempt, useConnectionMethod, useDiscoveredAccounts, useManagedAccounts, useSourceMutations, useSourcesOverview,
} from '@/hooks/use-integration-sources';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BackLink, Chip, ConnectFormSection, DetailHeader, GroupHeading } from './parts';
import { ToolList } from './provider-detail';
import { connectionIdentity, type ApprovalMode, type Connection, type ToolkitInfo, type WritePolicyAction } from './types';

export interface ApplicationDetailProps {
  applicationId: ApplicationId;
  /** Direct accounts (through Google) that cover this application. */
  directConnections: Connection[];
  /** The application's managed toolkits, from every source. */
  toolkits: ToolkitInfo[];
  writePolicy: Record<string, WritePolicyAction>;
  onSetApproval: (actionId: string, mode: ApprovalMode) => void;
  onBack: () => void;
  onOpenSources: () => void;
  /** Open the direct connector's page (Google), where direct accounts and own OAuth apps live. */
  onOpenDirect: () => void;
  /** Start a direct sign-in for just this application's service. */
  onConnectDirect: () => Promise<void>;
  /** Where a sign-in started here returns the browser. */
  returnTo: string;
  /** A sign-in the browser just came back from: show how it ended, and the agent access step. */
  initialAttemptId?: string | null;
  onChanged: () => void;
}

const LOGO: Record<ApplicationId, string> = { gmail: 'gmail', google_calendar: 'google' };

export function ApplicationDetail(props: ApplicationDetailProps) {
  const app = APPLICATIONS[props.applicationId];
  const accounts = useManagedAccounts();
  const overview = useSourcesOverview();
  // Every source that can be read now, whether or not this home has an account through it yet:
  // an account disconnected from Ri can be added back from here.
  const usableSources = useMemo(() => (overview.data?.sources ?? []).filter(source => source.enabled && source.hasKey).map(source => ({ id: source.id, label: source.label })), [overview.data]);
  const managed = useMemo(() => (accounts.data ?? []).filter(account => account.applicationId === props.applicationId), [accounts.data, props.applicationId]);
  const [attemptId, setAttemptId] = useState<string | null>(props.initialAttemptId ?? null);
  const [justConnected, setJustConnected] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const total = managed.length + props.directConnections.length;
  const showConnect = total === 0 || adding;
  const toolCount = props.toolkits.reduce((n, t) => n + t.actions.length, 0);
  const anyNeedsReconnect = managed.some(account => account.status === 'needs_reauth') || props.directConnections.some(c => c.status !== 'active');

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <BackLink onBack={props.onBack} busy={accounts.isFetching && !accounts.data} />
        <DetailHeader
          logo={<IntegrationLogo providerId={LOGO[props.applicationId]} name={app.displayName} size={48} />}
          title={app.displayName}
          subtitle={props.applicationId === 'gmail' ? 'Let agents find, read, draft and send mail.' : 'Let agents see and create events, and show your calendar in Ri.'}
          meta={total > 0
            ? <Chip tone={anyNeedsReconnect ? 'warn' : 'ok'}>{total === 1 ? (anyNeedsReconnect ? 'Needs attention' : 'Connected') : `${total} accounts connected`}</Chip>
            : <Chip>Not connected</Chip>}
        />
      </div>

      {banner && <p role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">{banner}</p>}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {attemptId && (
        <PendingSignIn
          attemptId={attemptId}
          appName={app.displayName}
          onDone={(result) => {
            setAttemptId(null);
            setAdding(false);
            if (result.status === 'completed') {
              setBanner(`Connected ${app.displayName}${result.account ? ` · ${result.account}` : ''}. Choose which agents can use it below.`);
              setJustConnected(result.connectionId);
            } else if (result.status !== 'cancelled') {
              setError(result.error);
            }
            props.onChanged();
          }}
        />
      )}

      {total > 0 && (
        <section className="space-y-2">
          <GroupHeading
            count={total}
            action={!adding && !attemptId && (
              <Button variant="outline" size="xs" className="text-xs" onClick={() => setAdding(true)}>
                <Plus size={12} /> Add account
              </Button>
            )}
          >
            Accounts
          </GroupHeading>
          {adding && !attemptId && (
            <ConnectFormSection opened>
              <ConnectMethodPanel {...props} onStarted={setAttemptId} onError={setError} onCancel={() => setAdding(false)} />
            </ConnectFormSection>
          )}
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-card/20">
            {managed.map(account => (
              <ManagedAccountRow
                key={account.connectionId}
                account={account}
                returnTo={props.returnTo}
                startOpen={justConnected === account.connectionId}
                onReconnect={setAttemptId}
                onMessage={setBanner}
                onError={setError}
                onChanged={props.onChanged}
              />
            ))}
            {props.directConnections.map(connection => (
              <div key={connection.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{connectionIdentity(connection)}</span>
                    <Chip>Direct, through Google</Chip>
                    {connection.status !== 'active' && <Chip tone="warn">{connection.status}</Chip>}
                  </div>
                </div>
                <Button variant="ghost" size="xs" className="ml-auto text-xs" onClick={props.onOpenDirect}>Manage in Google</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {showConnect && !attemptId && total === 0 && (
        <ConnectFormSection opened={false}>
          <GroupHeading>Connect</GroupHeading>
          <ConnectMethodPanel {...props} onStarted={setAttemptId} onError={setError} />
        </ConnectFormSection>
      )}

      {usableSources.length > 0 && <ExistingAccounts applicationId={props.applicationId} sources={usableSources} onChanged={props.onChanged} onError={setError} />}

      {toolCount > 0 && <ToolList toolkits={props.toolkits} writePolicy={props.writePolicy} onSetApproval={props.onSetApproval} />}
    </div>
  );
}

// ── Connecting ──────────────────────────────────────────────

function optionKey(option: MethodOption): string {
  if (option.kind === 'setup') return `setup:${option.sourceKind}`;
  return option.kind === 'managed' ? `source:${option.source.id}` : 'direct';
}

function optionTitle(option: MethodOption, appName: string): string {
  if (option.kind === 'managed') return option.source.label;
  if (option.kind === 'direct') return `Direct ${appName} sign-in, through Google`;
  return 'Composio';
}

function ConnectMethodPanel(props: ApplicationDetailProps & { onStarted: (attemptId: string) => void; onError: (message: string | null) => void; onCancel?: () => void }) {
  const app = APPLICATIONS[props.applicationId];
  const method = useConnectionMethod(props.applicationId, 'agent_tools');
  const m = useSourceMutations();
  const [changing, setChanging] = useState(false);
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [calendarUse, setCalendarUse] = useState(true);
  const [starting, setStarting] = useState(false);
  const selection = method.data;
  const options = useMemo(() => selection ? [selection.primary, ...selection.alternatives].filter((o): o is MethodOption => Boolean(o)) : [], [selection]);
  const chosen = (chosenKey ? options.find(option => optionKey(option) === chosenKey) : undefined) ?? selection?.primary ?? null;
  const explicit = Boolean(chosenKey && selection?.primary && chosenKey !== optionKey(selection.primary));

  if (method.isLoading) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Checking how to connect…</p>;
  if (method.error) return <p role="alert" className="text-xs text-destructive">{sourceErrorMessage(method.error)}</p>;
  if (!selection) return null;

  const connect = async () => {
    if (!chosen || !chosen.available) return;
    props.onError(null);
    setStarting(true);
    try {
      if (chosen.kind === 'managed') {
        const result = await m.connect.mutateAsync({
          applicationId: props.applicationId, sourceId: chosen.source.id, explicitChoice: explicit,
          ...(label.trim() ? { label: label.trim() } : {}), returnTo: props.returnTo,
          ...(props.applicationId === 'google_calendar' ? { calendarUse } : {}),
        });
        props.onStarted(result.attemptId);
        await openIntegrationAuthorization(result.authorizationUrl);
      } else if (chosen.kind === 'direct') {
        if (explicit && chosen.method && !('sourceId' in chosen.method)) {
          await m.setApplicationMethod.mutateAsync({ applicationId: props.applicationId, method: chosen.method });
        }
        await props.onConnectDirect();
      }
    } catch (e) {
      props.onError(sourceErrorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const explanation = (() => {
    if (!chosen) return null;
    if (chosen.kind === 'managed') {
      const why = explicit ? `the method you picked for ${app.displayName}` : selection.basis === 'override' ? `the method you chose for ${app.displayName}` : selection.basis === 'preferred' ? 'your preferred source' : null;
      return `Using ${chosen.source.label}${why ? `, ${why}` : ''}. ${chosen.source.label} stores this connection and processes its tool requests.`;
    }
    if (chosen.kind === 'direct') return `Using a direct sign-in with your Google OAuth app. The account's tokens stay on this home.`;
    return null;
  })();

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card/20 p-4">
      {selection.notice && !chosenKey && (
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {selection.notice}</p>
      )}
      {chosen ? (
        <div className="space-y-3">
          {explanation && <p className="text-xs leading-normal text-foreground/90">{explanation}</p>}
          {chosen.kind === 'managed' && (
            <div className="flex flex-wrap items-center gap-2">
              <Input value={label} onChange={e => setLabel(e.target.value)} maxLength={80} placeholder="Name it, like Work (optional)" aria-label={`Name for this ${app.displayName} account`} className="h-8 min-w-0 flex-1 basis-48 text-xs" />
            </div>
          )}
          {chosen.kind === 'managed' && props.applicationId === 'google_calendar' && (
            <label className="flex items-center gap-2 text-xs text-foreground/90">
              <Checkbox checked={calendarUse} onCheckedChange={value => setCalendarUse(value === true)} />
              Show it in Ri&apos;s Calendar and use it for the deck
            </label>
          )}
          {chosen.available ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="text-xs font-semibold" onClick={() => void connect()} disabled={starting}>
                {starting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Connect {app.displayName}
              </Button>
              {options.length > 1 && (
                <Button variant="ghost" size="xs" className="text-xs" aria-expanded={changing} onClick={() => setChanging(open => !open)}>
                  Change method <ChevronDown size={12} className={changing ? 'rotate-180' : undefined} />
                </Button>
              )}
              {props.onCancel && <Button variant="ghost" size="xs" className="text-xs" onClick={props.onCancel}>Cancel</Button>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{chosen.reason}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-xs text-foreground/90">
          <p>{app.displayName} needs a way to connect first.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="text-xs" onClick={props.onOpenSources}>Set up Composio</Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={props.onOpenDirect}>Use your own Google OAuth app</Button>
          </div>
        </div>
      )}

      {changing && (
        <div role="radiogroup" aria-label="Connection method" className="space-y-1 border-t border-border/60 pt-3">
          {options.map(option => {
            const key = optionKey(option);
            const selected = chosen ? key === optionKey(chosen) : false;
            const onPick = () => {
              if (option.kind === 'setup') { props.onOpenSources(); return; }
              if (option.kind === 'direct' && !option.available) { props.onOpenDirect(); return; }
              setChosenKey(key);
              setChanging(false);
            };
            return (
              <button
                key={key} type="button" role="radio" aria-checked={selected} onClick={onPick}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
              >
                <span className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center">{selected && <Check size={13} className="text-primary" />}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{optionTitle(option, app.displayName)}</span>
                  {option.reason && <span className="block text-[11px] text-muted-foreground">{option.reason}{option.kind === 'direct' && !option.available ? ' Set it up on the Google page.' : ''}</span>}
                </span>
              </button>
            );
          })}
          {selection.basis === 'override' && (
            <button type="button" className="px-2 pt-1 text-[11px] font-medium text-primary hover:underline"
              onClick={() => void m.setApplicationMethod.mutateAsync({ applicationId: props.applicationId, method: null }).then(() => setChosenKey(null)).catch(e => props.onError(sourceErrorMessage(e)))}>
              Use the overall preference for {app.displayName} again
            </button>
          )}
          {explicit && <p className="px-2 pt-1 text-[11px] text-muted-foreground">Ri remembers this choice for {app.displayName}.</p>}
        </div>
      )}
    </div>
  );
}

type AttemptResult =
  | { status: 'completed'; connectionId: string; account?: string }
  | { status: 'failed' | 'expired' | 'cancelled'; error: string };

/** A sign-in in progress: finishes from the callback, or by polling when it can't reach this home. */
function PendingSignIn({ attemptId, appName, onDone }: { attemptId: string; appName: string; onDone: (result: AttemptResult) => void }) {
  const attempt = useConnectAttempt(attemptId);
  const m = useSourceMutations();
  const reported = useRef(false);
  const status = attempt.data;
  const failure = attempt.error;
  useEffect(() => {
    if (reported.current) return;
    if (status && status.status !== 'pending') {
      reported.current = true;
      onDone(status.status === 'completed'
        ? { status: 'completed', connectionId: status.connectionId, account: status.account }
        : { status: status.status, error: status.error });
    } else if (failure) {
      reported.current = true;
      onDone({ status: 'failed', error: sourceErrorMessage(failure) });
    }
  }, [status, failure, onDone]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <span className="flex items-center gap-2 text-xs"><Loader2 size={13} className="animate-spin text-muted-foreground" /> Finish signing in to {appName} in your browser.</span>
      <Button variant="outline" size="sm" className="text-xs" onClick={() => void m.cancelAttempt.mutateAsync({ attemptId }).finally(() => onDone({ status: 'cancelled', error: 'Cancelled.' }))}>
        Cancel
      </Button>
    </div>
  );
}

// ── Accounts ────────────────────────────────────────────────

function ManagedAccountRow({ account, returnTo, startOpen, onReconnect, onMessage, onError, onChanged }: {
  account: ManagedAccountView;
  returnTo: string;
  startOpen: boolean;
  onReconnect: (attemptId: string) => void;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
  onChanged: () => void;
}) {
  const m = useSourceMutations();
  const confirm = useConfirm();
  // The account just connected opens its agent access step (connecting grants nothing), until
  // the person toggles it themselves.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const agentsOpen = toggled ?? startOpen;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(account.label ?? '');
  const identity = account.verifiedEmail ?? account.label ?? 'Account';
  const reconnect = account.status === 'needs_reauth';

  const act = async (work: () => Promise<unknown>) => {
    onError(null);
    try { await work(); onChanged(); } catch (e) { onError(sourceErrorMessage(e)); }
  };

  const disconnect = async () => {
    if (!(await confirm({
      title: `Disconnect ${identity} from Ri?`,
      description: `Agents stop using it right away. The account stays connected in your ${account.sourceLabel} project, so you can add it back later or remove it there.`,
      confirmLabel: 'Disconnect',
    }))) return;
    await act(async () => {
      await m.disconnect.mutateAsync({ connectionId: account.connectionId });
      onMessage(`Disconnected ${identity} from Ri. It is still in ${account.sourceLabel}.`);
    });
  };

  const revoke = async () => {
    if (!(await confirm({
      title: `Revoke ${identity} in ${account.sourceLabel}?`,
      description: `This disconnects it from Ri and removes it from your ${account.sourceLabel} project, revoking its sign-in where ${account.sourceLabel} can. Anything else using that account through ${account.sourceLabel} stops working too.`,
      confirmLabel: 'Revoke',
      tone: 'destructive',
    }))) return;
    await act(async () => {
      const result = await m.revoke.mutateAsync({ connectionId: account.connectionId });
      const outcome = result.outcome;
      onMessage(outcome.kind === 'revoked'
        ? `Revoked ${identity} and removed it from ${result.sourceLabel}.`
        : outcome.kind === 'revoke_unsupported'
          ? `${result.sourceLabel} can't revoke this sign-in with the provider. The account was ${outcome.disabled ? 'turned off and ' : ''}removed from ${result.sourceLabel}. Revoke it in your Google account settings to be sure.`
          : `Disconnected from Ri, but ${result.sourceLabel} cleanup failed: ${outcome.reason}`);
    });
  };

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-48">
          {renaming ? (
            <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); void act(async () => { await m.renameAccount.mutateAsync({ connectionId: account.connectionId, label: name }); setRenaming(false); }); }}>
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Work" aria-label="Account name" className="h-7 text-xs" autoFocus />
              <Button type="submit" size="xs">Save</Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setRenaming(false)}>Cancel</Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">{identity}</span>
              {account.label && account.verifiedEmail && <Chip>{account.label}</Chip>}
              <Chip>via {account.sourceLabel}</Chip>
              {!account.sourceEnabled ? <Chip tone="off">{account.sourceLabel} is off</Chip>
                : reconnect ? <Chip tone="warn">Sign-in needed</Chip> : <Chip tone="ok">Connected</Chip>}
            </div>
          )}
          {account.calendarUse !== null && (
            <label className="mt-1.5 flex w-fit items-center gap-2 text-[11px] text-muted-foreground">
              <Switch size="sm" checked={account.calendarUse} aria-label="Show in Ri's Calendar"
                onCheckedChange={on => void act(() => m.setCalendarUse.mutateAsync({ connectionId: account.connectionId, enabled: on }))} />
              <CalendarDays size={12} /> Show in Ri&apos;s Calendar and deck
            </label>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {reconnect && account.sourceEnabled && (
            <Button variant="ghost" size="xs" className="text-xs" onClick={() => void act(async () => {
              const result = await m.reconnect.mutateAsync({ connectionId: account.connectionId, returnTo });
              onReconnect(result.attemptId);
              await openIntegrationAuthorization(result.authorizationUrl);
            })}>
              <RefreshCw size={12} /> Reconnect
            </Button>
          )}
          <Button variant="ghost" size="xs" className="text-xs" aria-expanded={agentsOpen} onClick={() => setToggled(!agentsOpen)}>
            <Bot size={12} /> Agents
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Tip label="More for this account">
                <Button variant="ghost" size="icon-xs" aria-label={`More for ${identity}`}><MoreHorizontal size={12} /></Button>
              </Tip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="text-xs" onSelect={() => { setName(account.label ?? ''); setRenaming(true); }}><Pencil size={12} /> Rename</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs" onSelect={() => void disconnect()}><Unplug size={12} /> Disconnect from Ri</DropdownMenuItem>
              <DropdownMenuItem className="text-xs text-destructive focus:text-destructive" onSelect={() => void revoke()}><Trash2 size={12} /> Revoke in {account.sourceLabel}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {agentsOpen && <AgentAccess account={account} onError={onError} />}
    </div>
  );
}

/**
 * Which agents can use this exact account. A managed account is always granted by name: there is
 * no "all accounts" for a managed source, so connecting another account never widens an agent.
 */
function AgentAccess({ account, onError }: { account: ManagedAccountView; onError: (message: string | null) => void }) {
  const qc = useQueryClient();
  const agents = useQuery({ ...trpc.workspaces.list.queryOptions({}), staleTime: 10_000 });
  const [saving, setSaving] = useState<string | null>(null);
  const pin = { accountId: account.accountId };
  const list = (Array.isArray(agents.data) ? agents.data : []) as Array<{ id: string; name: string; integrationScopes?: WorkspaceIntegrationScope[] | null }>;

  const has = (scopes: WorkspaceIntegrationScope[]) => scopes.some(scope => scope.toolkitId === account.toolkitId && scopePins(scope).some(p => pinKey(p) === pinKey(pin)));
  const toggle = async (agent: (typeof list)[number], on: boolean) => {
    onError(null);
    setSaving(agent.id);
    const scopes = agent.integrationScopes ?? [];
    const next: WorkspaceIntegrationScope[] = on
      ? scopes.some(scope => scope.toolkitId === account.toolkitId)
        ? scopes.map(scope => scope.toolkitId === account.toolkitId ? { toolkitId: scope.toolkitId, accounts: [...scopePins(scope), pin] } : scope)
        : [...scopes, { toolkitId: account.toolkitId, accounts: [pin] }]
      : scopes.flatMap(scope => {
        if (scope.toolkitId !== account.toolkitId) return [scope];
        const rest = scopePins(scope).filter(p => pinKey(p) !== pinKey(pin));
        // The last account leaves the service: never an empty list, which would mean every account.
        return rest.length ? [{ toolkitId: scope.toolkitId, accounts: rest }] : [];
      });
    try {
      await trpcClient.workspaces.integrationScopesPut.mutate({ params: { id: agent.id }, body: { scopes: next } });
      await qc.invalidateQueries({ queryKey: trpc.workspaces.list.queryKey() });
    } catch (e) {
      onError(sourceErrorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mt-2 space-y-1 rounded-lg border border-border/60 bg-muted/20 p-2.5">
      <p className="text-[11px] text-muted-foreground">Agents that can use {account.verifiedEmail ?? 'this account'}. The main chat can always use it.</p>
      {agents.isLoading && <p className="text-[11px] text-muted-foreground"><Loader2 size={11} className="mr-1 inline animate-spin" />Loading agents…</p>}
      {list.length === 0 && !agents.isLoading && <p className="text-[11px] text-muted-foreground">No agents yet.</p>}
      {list.map(agent => {
        const on = has(agent.integrationScopes ?? []);
        return (
          <label key={agent.id} className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox checked={on} disabled={saving === agent.id} onCheckedChange={value => void toggle(agent, value === true)} />
            <span className="truncate">{agent.name}</span>
            {saving === agent.id && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
          </label>
        );
      })}
    </div>
  );
}

/** Accounts the source's own user already has in Composio but Ri doesn't use yet. */
function ExistingAccounts({ applicationId, sources, onChanged, onError }: {
  applicationId: ApplicationId;
  sources: { id: string; label: string }[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const sourceId = sources.find(source => source.id === picked)?.id ?? sources[0]?.id ?? null;
  const discovered = useDiscoveredAccounts(sourceId, applicationId, open);
  const m = useSourceMutations();
  const pending = (discovered.data ?? []).filter(account => !account.imported && account.status === 'ACTIVE');
  if (!sourceId) return null;
  return (
    <section className="rounded-xl border border-border/70">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/30">
        <ExternalLink size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">Accounts already in Composio</span>
          <span className="block text-[11px] text-muted-foreground">Add one this home connected before, without signing in again.</span>
        </span>
        <ChevronDown size={14} className={open ? 'shrink-0 rotate-180 text-muted-foreground' : 'shrink-0 text-muted-foreground'} />
      </button>
      {open && (
        <div className="space-y-1 border-t border-border/60 p-3">
          {sources.length > 1 && (
            <Select value={sourceId} onValueChange={setPicked}>
              <SelectTrigger size="sm" aria-label="Source" className="mb-1 h-7 w-fit text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {sources.map(source => <SelectItem key={source.id} value={source.id} className="text-xs">{source.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {discovered.isLoading && <p className="text-[11px] text-muted-foreground"><Loader2 size={11} className="mr-1 inline animate-spin" />Looking…</p>}
          {discovered.error && <p className="text-[11px] text-destructive">{sourceErrorMessage(discovered.error)}</p>}
          {!discovered.isLoading && pending.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing to add. Every account here is already in Ri.</p>}
          {pending.map(account => (
            <div key={account.remoteAccountId} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{account.alias ?? 'Unnamed account'}{account.createdAt ? `, added ${new Date(account.createdAt).toLocaleDateString()}` : ''}</span>
              <Button size="xs" variant="outline" className="text-xs" disabled={m.importAccount.isPending}
                onClick={() => void m.importAccount.mutateAsync({ sourceId, applicationId, remoteAccountId: account.remoteAccountId })
                  .then(onChanged).catch(e => onError(sourceErrorMessage(e)))}>
                Add
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
