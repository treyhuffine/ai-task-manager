'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy, Plug } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorText } from '@/lib/api/client';
import type { AiClientView } from '@/lib/db/queries';
import { AI_CLIENT_KINDS, aiClientSetup, type AiClientKind } from '@/lib/external-ai/client-config';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

const buttonClass = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted/50 disabled:opacity-50';

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Connection = { client: AiClientView; token: string; mcpUrl: string; reachable: boolean };
interface ExternalAssistantsProps {
  space: { kind: 'team' | 'personal'; name: string };
  clients: AiClientView[];
  createClient: (name: string) => Promise<Connection>;
  revokeClient: (keyId: string) => Promise<unknown>;
  onChanged: () => void;
  ready?: boolean;
  children?: ReactNode;
}

/** The same one-time connection instructions and revocation controls for both kinds of Home. */
export function ExternalAssistants({ space, clients, createClient, revokeClient, onChanged, ready = true, children }: ExternalAssistantsProps) {
  const personal = space.kind === 'personal';
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const disconnect = useMutation({
    mutationFn: (keyId: string) => revokeClient(keyId),
    onSuccess: onChanged,
    onError: (err) => toast.error(apiErrorText(err)),
  });
  return (
    <section className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Assistants outside Ri</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {personal ? 'Give an assistant you use outside Ri access to your Home’s tasks, notes, areas and priority deck. It uses your assistant’s existing model access.' : `Let Claude Code, Codex or another assistant you already use read and update ${space.name}’s shared work as you. This is optional. To chat inside Ri, use AI & Models.`}
      </p>
      {children}
      <div className="mt-2 space-y-2">
        {clients.length > 0 && (
          <ul className="divide-y divide-border/60 rounded-md border border-border">
            {clients.map((client) => (
              <li key={client.keyId} className="flex items-center gap-2 px-3 py-2 text-xs">
                <Plug size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{client.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {client.lastUsedAt ? `Used ${when(client.lastUsedAt)}` : 'Not used yet'}
                </span>
                <button
                  type="button"
                  className="shrink-0 underline text-muted-foreground"
                  disabled={disconnect.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Disconnect ${client.name}?`,
                      description: 'Its key stops working at its next request. Existing tasks and notes stay in Ri.',
                      confirmLabel: 'Disconnect',
                      tone: 'destructive',
                    });
                    if (ok) disconnect.mutate(client.keyId);
                  }}
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={buttonClass} disabled={!ready} onClick={() => setOpen(true)}>
          <Plug size={13} aria-hidden /> Connect an external assistant
        </button>
      </div>
      <ConnectAiDialog open={open} onOpenChange={setOpen} onConnected={onChanged} space={space} createClient={createClient} />
    </section>
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
          className={cn(buttonClass, 'shrink-0')}
          onClick={async () => {
            try { await navigator.clipboard.writeText(text); }
            catch { toast.error('Could not copy. Select the text and copy it manually.'); return; }
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

type Made = { name: string; token: string; mcpUrl: string; reachable: boolean; kind: AiClientKind };

function ConnectAiDialog({ open, onOpenChange, onConnected, space, createClient }: { open: boolean; onOpenChange: (open: boolean) => void; onConnected: () => void } & Pick<ExternalAssistantsProps, 'space' | 'createClient'>) {
  const personal = space.kind === 'personal';
  const [kind, setKind] = useState<AiClientKind>('claude_code');
  const [name, setName] = useState('');
  const [made, setMade] = useState<Made | null>(null);
  const create = useMutation({
    mutationFn: () => createClient(name.trim() || AI_CLIENT_KINDS.find(option => option.kind === kind)!.defaultName),
    onSuccess: (result) => {
      setMade({ name: result.client.name, token: result.token, mcpUrl: result.mcpUrl, reachable: result.reachable, kind });
      onConnected();
    },
    onError: (err) => toast.error(apiErrorText(err)),
  });
  const close = (next: boolean) => {
    if (create.isPending) return;
    onOpenChange(next);
    if (!next) {
      // The key is never shown again once this closes.
      setMade(null);
      setKind('claude_code');
      setName('');
    }
  };
  const setup = made ? aiClientSetup(made.kind, { ...(personal ? { homeName: space.name } : { teamName: space.name }), mcpUrl: made.mcpUrl, token: made.token }) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] w-full max-w-[calc(100%-1rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{made ? `Set up ${made.name}` : 'Connect an external assistant'}</DialogTitle>
          <DialogDescription>
            {made
              ? `Copy the key now: Ri shows it only this once. Anyone with it can read and change ${personal ? 'your Home’s tasks, notes, areas and priority deck' : 'the team’s shared work'} as you.`
              : `MCP gives your assistant tools to search, read and update ${personal ? 'your Home’s tasks, notes, areas and priority deck' : `${space.name}’s shared tasks, notes and decisions`}. You run that assistant outside Ri. You can disconnect its access here any time.`}
          </DialogDescription>
        </DialogHeader>

        {!made ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!create.isPending) create.mutate();
            }}
          >
            <fieldset className="space-y-1.5" disabled={create.isPending}>
              <legend className="text-xs font-medium">Which assistant</legend>
              <div className="flex flex-wrap gap-2">
                {AI_CLIENT_KINDS.map((option) => (
                  <label
                    key={option.kind}
                    className={cn(
                      'cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium',
                      kind === option.kind ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="ai-client-kind"
                      className="sr-only"
                      checked={kind === option.kind}
                      onChange={() => {
                        setKind(option.kind);
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Connection label (optional)</summary>
              <label className="mt-2 block space-y-1">
                <span className="text-xs font-medium">Connection label</span>
                <input
                  value={name}
                  disabled={create.isPending}
                  placeholder={AI_CLIENT_KINDS.find(option => option.kind === kind)!.defaultName}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  aria-describedby="connection-label-hint"
                  className="w-full rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus-visible:border-primary/60"
                />
              </label>
              <p id="connection-label-hint" className="mt-1 text-xs text-muted-foreground">Defaults to the assistant’s name. Add a label if you connect it from more than one device.</p>
            </details>
            <DialogFooter>
              <button type="submit" className={cn(buttonClass, 'px-3 py-1.5')} disabled={create.isPending}>
                {create.isPending ? 'Preparing…' : 'Get connection instructions'}
              </button>
            </DialogFooter>
          </form>
        ) : (
          <div className="min-w-0 space-y-4">
            {setup!.steps.map((step, index) => (
              <CopyBlock key={index} label={`${index + 1}. ${step.label}`} text={step.text} />
            ))}
            <p className="text-xs text-muted-foreground">
              {setup!.steps.length + 1}. {personal ? 'Ask your assistant “What tasks are due this week?” or “Save a note in my Ri.”' : `Ask your assistant “What has ${space.name} decided about billing?” or “Record that we chose weekly releases as a decision.”`}
            </p>
            {!made.reachable && (
              <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {personal ? 'This is a local address. To connect from another computer, set a remote address in Settings → Devices, then create a new connection here.' : 'This address works only on this computer until the team has an address people can reach. Its owner sets one in Settings.'}
              </p>
            )}
            {setup!.caveat && <p className="text-xs text-muted-foreground">{setup!.caveat}</p>}
            <DialogFooter>
              <button type="button" className={cn(buttonClass, 'px-3 py-1.5')} onClick={() => close(false)}>
                Done
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
