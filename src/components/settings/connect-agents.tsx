'use client';

import { useState, type ReactNode } from 'react';
import { Check, ClipboardCopy, Copy, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { AiClientView } from '@/lib/db/queries';
import {
  AI_CLIENTS,
  aiClientInstallLink,
  aiClientOfKey,
  aiClientSetup,
  aiClientSetupPrompt,
  type AiClientDef,
  type AiClientKind,
  type AiConnectionTarget,
} from '@/lib/external-ai/client-config';
import type { LocalAgentState, LocalConnectResult } from '@/lib/external-ai/local-setup';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Tip } from '@/components/ui/tip';
import { cn } from '@/lib/utils';
import { AiClientLogo } from './ai-client-logo';

const buttonClass = 'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50';
const primaryClass = 'inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const used = (key: Pick<AiClientView, 'lastUsedAt'>) => (key.lastUsedAt ? `Used ${ago(key.lastUsedAt)}` : 'Not used yet');

/** A key made in an item, shown while Settings is open and never again. */
export interface MadeKey {
  client: AiClientView;
  token: string;
  mcpUrl: string;
  reachable: boolean;
}

/** Agents on the computer running Ri, which Ri sets up in one action. Personal only. */
export interface LocalAgents {
  /** The computer's name, for "On Trey's Mac". */
  device: string | null;
  agents: LocalAgentState[] | undefined;
  /** Still finding out what's installed. */
  loading: boolean;
  setUp: (kind: AiClientKind) => Promise<LocalConnectResult>;
  disconnect: (kind: AiClientKind) => Promise<unknown>;
}

export interface ConnectAgentsProps {
  /** Where agents connect and their names there. The address is known before any key. */
  target: AiConnectionTarget | null;
  keys: AiClientView[];
  createKey: (kind: AiClientKind) => Promise<MadeKey>;
  revokeKey: (keyId: string) => Promise<unknown>;
  onChanged: () => void;
  local?: LocalAgents;
  ready?: boolean;
  /** Notes above the list: what agents can reach and the address they use. */
  children?: ReactNode;
}

/**
 * Settings → Connect your agent, for a personal Ri and for a team: every
 * outside agent Ri knows, most popular first, each with its complete steps
 * (`src/lib/external-ai/client-config.ts`). A key is made inside an item the
 * moment its steps, install link or setup prompt need one, never in a
 * separate dialog, and each agent's keys are listed and disconnected in its
 * own item. On a personal Ri, an agent installed on the computer running it
 * also gets Set up, which connects it in one action.
 */
export function ConnectAgents({ target, keys, createKey, revokeKey, onChanged, local, ready = true, children }: ConnectAgentsProps) {
  return (
    <section className="min-w-0 space-y-3">
      {children}
      <Accordion type="multiple" className="rounded-lg">
        {AI_CLIENTS.map((client) => (
          <ClientItem
            key={client.kind}
            client={client}
            target={target}
            keys={keys.filter(key => aiClientOfKey(key) === client.kind)}
            createKey={createKey}
            revokeKey={revokeKey}
            onChanged={onChanged}
            local={local}
            localState={local?.agents?.find(agent => agent.kind === client.kind)}
            ready={ready}
          />
        ))}
      </Accordion>
    </section>
  );
}

interface ClientItemProps extends Omit<ConnectAgentsProps, 'children' | 'keys'> {
  client: AiClientDef;
  keys: AiClientView[];
  localState: LocalAgentState | undefined;
  ready: boolean;
}

function StatusChip({ tone, children }: { tone: 'on' | 'waiting' | 'off'; children: ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium',
      tone === 'on' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : tone === 'waiting' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
    )}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', tone === 'on' ? 'bg-emerald-500' : tone === 'waiting' ? 'bg-amber-500' : 'bg-muted-foreground/50')} />
      {children}
    </span>
  );
}

function ClientItem({ client, target, keys, createKey, revokeKey, onChanged, local, localState, ready }: ClientItemProps) {
  const confirm = useConfirm();
  const [made, setMade] = useState<MadeKey | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [setupResult, setSetupResult] = useState<LocalConnectResult | null>(null);
  const localKeyId = localState?.connection?.keyId ?? null;
  const otherKeys = keys.filter(key => key.keyId !== localKeyId);
  const steps = target ? aiClientSetup(client.kind, made ? { ...target, mcpUrl: made.mcpUrl } : target, made?.token ?? null) : null;
  const linkPreview = target ? aiClientInstallLink(client.kind, target, 'preview') : null;

  const makeKey = useMutation({
    mutationFn: () => createKey(client.kind),
    onSuccess: (key) => { setMade(key); onChanged(); },
    onError: (err) => toast.error(apiErrorText(err)),
  });
  /** The item's key, made now if it has none yet. */
  const ensureKey = async () => made ?? await makeKey.mutateAsync();

  const setUp = useMutation({
    mutationFn: () => local!.setUp(client.kind),
    onSuccess: (result) => {
      setSetupResult(result);
      toast.success(`${client.label} is connected to Ri`, { description: result.next });
      onChanged();
    },
    onError: (err) => toast.error(`Could not set up ${client.label}`, { description: apiErrorText(err) }),
  });
  const disconnectLocal = useMutation({
    mutationFn: () => local!.disconnect(client.kind),
    onSuccess: () => { setSetupResult(null); toast.success(`${client.label} is disconnected`); onChanged(); },
    onError: (err) => toast.error(`Could not disconnect ${client.label}`, { description: apiErrorText(err) }),
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => revokeKey(keyId),
    onSuccess: (_result, keyId) => { if (made?.client.keyId === keyId) setMade(null); onChanged(); },
    onError: (err) => toast.error(apiErrorText(err)),
  });

  const connectedHere = Boolean(localState?.connection);
  const anyUsed = keys.some(key => key.lastUsedAt);
  const chip = client.limitation
    ? <StatusChip tone="off">Not available yet</StatusChip>
    : connectedHere || anyUsed
      ? <StatusChip tone="on">Connected</StatusChip>
      : keys.length > 0
        ? <StatusChip tone="waiting">Key not used yet</StatusChip>
        : localState?.installed
          ? <StatusChip tone="off">Installed</StatusChip>
          : null;

  const openLink = async () => {
    if (!target) return;
    const key = await ensureKey().catch(() => null);
    if (!key) return;
    const link = aiClientInstallLink(client.kind, { ...target, mcpUrl: key.mcpUrl }, key.token);
    if (link) window.location.assign(link.href);
  };

  const copyPrompt = async () => {
    if (!target) return;
    const key = await ensureKey().catch(() => null);
    if (!key) return;
    const text = aiClientSetupPrompt(client.kind, { ...target, mcpUrl: key.mcpUrl }, key.token);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Setup prompt copied', { description: `Paste it into ${client.kind === 'other' ? 'your agent' : client.label} on the other computer.` });
      setPrompt(null);
    } catch {
      // Some browsers only copy on the click itself. Show it to copy from.
      setPrompt(text);
    }
  };

  const askDisconnect = async (what: 'local' | AiClientView) => {
    const ok = await confirm(what === 'local'
      ? { title: `Disconnect ${client.label}?`, description: `Ri removes itself from ${client.label}’s configuration on this computer and turns off its key. Your tasks and notes stay in Ri.`, confirmLabel: 'Disconnect', tone: 'destructive' }
      : { title: `Disconnect ${what.name}?`, description: 'Its key stops working at its next request. Your tasks and notes stay in Ri.', confirmLabel: 'Disconnect', tone: 'destructive' });
    if (!ok) return;
    if (what === 'local') disconnectLocal.mutate();
    else revoke.mutate(what.keyId);
  };

  const showLocal = Boolean(local && client.local && localState?.installed);
  // Until it's known which key Set up wrote here, it would show among the others.
  const checking = Boolean(local?.loading && client.local);

  return (
    <AccordionItem value={client.kind} data-agent-client={client.kind}>
      <AccordionTrigger className="items-center gap-3 p-3 hover:no-underline">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <AiClientLogo id={client.logo} />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-foreground">{client.label}</span>
              {chip}
            </span>
            <span className="block truncate text-[11px] font-normal text-muted-foreground">{client.blurb}</span>
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="h-auto space-y-3 px-3 pb-3 [&_p:not(:last-child)]:mb-0 [&_a]:no-underline">
        {client.limitation ? (
          <p className="text-xs text-muted-foreground">{client.limitation}</p>
        ) : (
          <>
            {checking && (
              <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" aria-hidden /> Checking {local!.device ?? 'this computer'}
              </p>
            )}
            {showLocal && localState && (
              <LocalRow
                client={client}
                device={local!.device}
                state={localState}
                result={setupResult}
                busy={setUp.isPending || disconnectLocal.isPending}
                disabled={!ready}
                onSetUp={() => setUp.mutate()}
                onDisconnect={() => void askDisconnect('local')}
              />
            )}

            {(linkPreview || steps) && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {showLocal ? 'Or on any computer' : 'On any computer'}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {linkPreview && (
                      <Tip label={`Opens ${client.label}, which asks before adding Ri`}>
                        <button type="button" className={buttonClass} disabled={!ready || makeKey.isPending} onClick={() => void openLink()}>
                          <ExternalLink size={12} aria-hidden /> {linkPreview.label}
                        </button>
                      </Tip>
                    )}
                    {client.kind !== 'ri' && (
                      <Tip label="A prompt with a new key that an agent on another computer follows to set itself up">
                        <button type="button" className={buttonClass} disabled={!ready || makeKey.isPending} onClick={() => void copyPrompt()}>
                          <ClipboardCopy size={12} aria-hidden /> Copy setup prompt
                        </button>
                      </Tip>
                    )}
                  </div>
                </div>
                {prompt && <CopyBlock label="Copy this prompt into the agent on the other computer." text={prompt} />}
                {steps && (
                  <ol className="space-y-2.5">
                    {steps.steps.map((step, index) => (
                      <li key={index}>
                        {step.secret && !made ? (
                          <PendingKeyBlock
                            label={`${index + 1}. ${step.label}`}
                            text={step.text}
                            busy={makeKey.isPending}
                            disabled={!ready}
                            onCreate={() => makeKey.mutate()}
                          />
                        ) : (
                          <CopyBlock label={`${index + 1}. ${step.label}`} text={step.text} />
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {made && (
                  <p role="status" className="text-[11px] text-muted-foreground">
                    This key is shown only while Settings is open. Anyone with it can read and change your work as you, so keep it private.
                  </p>
                )}
                {made && !made.reachable && (
                  <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {target?.space.kind === 'team'
                      ? 'This address works only on the computer hosting the team until it has an address people can reach. Its owner sets one in Settings.'
                      : 'This is a local address, so these steps work only on the computer running Ri. Set a remote address in Settings → Devices to connect an agent elsewhere.'}
                  </p>
                )}
                {steps?.caveat && <p className="text-xs text-muted-foreground">{steps.caveat}</p>}
                {client.docsUrl && (
                  <a href={client.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <ExternalLink size={11} aria-hidden /> {client.label} MCP docs
                  </a>
                )}
              </div>
            )}

            {otherKeys.length > 0 && !checking && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Keys</p>
                <ul className="divide-y divide-border/60 rounded-md border border-border">
                  {otherKeys.map((key) => (
                    <li key={key.keyId} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <KeyRound size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{key.name}</span>
                      <span className="shrink-0 text-muted-foreground">{used(key)}</span>
                      <button type="button" className="shrink-0 text-muted-foreground underline" disabled={revoke.isPending} onClick={() => void askDisconnect(key)}>
                        Disconnect
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function LocalRow({ client, device, state, result, busy, disabled, onSetUp, onDisconnect }: {
  client: AiClientDef; device: string | null; state: LocalAgentState; result: LocalConnectResult | null;
  busy: boolean; disabled: boolean; onSetUp: () => void; onDisconnect: () => void;
}) {
  const where = device ? `On ${device}` : 'On this computer';
  const connection = state.connection;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{where}</p>
      <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs">
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', connection ? 'bg-emerald-500' : state.stale ? 'bg-amber-500' : 'bg-muted-foreground/40')} />
        <span className="min-w-0 flex-1">
          {connection ? (
            <>Connected <span className="text-muted-foreground">· {used(connection)} · {state.config}</span></>
          ) : state.stale === 'revoked' ? (
            <>Its key was disconnected. Set it up again to reconnect.</>
          ) : state.stale === 'elsewhere' ? (
            <>{state.config} already has a server with Ri’s name that points somewhere else.</>
          ) : (
            <>Ri adds itself to {client.label} for all your projects, with its own key, and installs Ri’s skill.</>
          )}
        </span>
        {connection ? (
          <button type="button" className={buttonClass} disabled={busy || disabled} onClick={onDisconnect}>
            {busy && <Loader2 size={12} className="animate-spin" aria-hidden />} Disconnect
          </button>
        ) : (
          <button type="button" className={primaryClass} disabled={busy || disabled} onClick={onSetUp}>
            {busy && <Loader2 size={12} className="animate-spin" aria-hidden />} Set up
          </button>
        )}
      </div>
      {connection && result && (
        <p role="status" className="text-xs text-muted-foreground">
          {result.next}
          {result.skills.state === 'ready' && ' Ri’s skill is installed for it.'}
          {result.skills.state === 'blocked' && ` Another skill already uses Ri’s skill name${result.skills.blocked.length ? ` at ${result.skills.blocked.join(', ')}` : ''}, so Ri left it alone.`}
        </p>
      )}
    </div>
  );
}

/** A step that needs the key: its text with a placeholder, and the button that makes one. */
function PendingKeyBlock({ label, text, busy, disabled, onCreate }: { label: string; text: string; busy: boolean; disabled: boolean; onCreate: () => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 p-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{text}</pre>
        <button type="button" className={primaryClass} disabled={busy || disabled} onClick={onCreate}>
          {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <KeyRound size={12} aria-hidden />} Create key
        </button>
      </div>
    </div>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] select-all">{text}</pre>
        <button
          type="button"
          className={buttonClass}
          onClick={async () => {
            try { await navigator.clipboard.writeText(text); }
            catch { toast.error('Could not copy. Select the text and copy it yourself.'); return; }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
