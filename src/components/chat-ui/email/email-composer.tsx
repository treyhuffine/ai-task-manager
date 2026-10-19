'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Loader2, Mail, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { useEmailDraft } from '@/hooks/use-email-draft';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { emailSendProblem, type EmailDraftFields } from '@/lib/email/validation';
import type { EmailDraft } from '@/db/types';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { openSettings, useSettingsStore } from '@/components/settings/settings-store';

export function EmailComposer({ id, sessionId, initial }: { id: string; sessionId: string; initial: EmailDraft }) {
  const recovery = useQuery({
    ...trpc.email.get.queryOptions({ id, sessionId }),
    enabled: initial.status === 'sending',
    refetchInterval: query => query.state.data?.draft.status === 'sending' ? 2000 : false,
  });
  const live = recovery.data && recovery.data.draft.revision > initial.revision ? recovery.data.draft : initial;
  const editor = useEmailDraft(id, sessionId, live);
  const { draft, confirmed, edits, conflict, save, hasEdits } = editor;
  const accounts = useQuery({ ...trpc.email.accounts.queryOptions(), enabled: draft.status === 'draft' });
  const settings = useSettingsStore();
  const previousSettingsOpen = useRef(settings.open);
  const refetchAccounts = accounts.refetch;
  useEffect(() => {
    const closed = previousSettingsOpen.current && !settings.open;
    previousSettingsOpen.current = settings.open;
    if (closed && draft.status === 'draft') void refetchAccounts();
  }, [settings.open, draft.status, refetchAccounts]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const labelId = useId();
  const send = useMutation({
    retry: false,
    mutationFn: () => trpcClient.email.send.mutate({ id, sessionId, expectedRevision: confirmed.revision }),
    onSuccess: result => editor.accept(result.draft),
    onError: error => { setMessage(`${error.message}. Review this draft before trying again`); void recovery.refetch(); },
  });
  const discard = useMutation({
    retry: false,
    mutationFn: () => trpcClient.email.discard.mutate({ id, sessionId, expectedRevision: confirmed.revision }),
    onSuccess: result => editor.accept(result.draft),
    onError: error => setMessage(error.message),
  });
  const busy = save.isPending || send.isPending || discard.isPending;
  const editable = draft.status === 'draft' && !send.isPending && !discard.isPending;
  const problem = emailSendProblem(draft) ?? (accounts.data && !accounts.data.some(account => account.id === draft.connectionId) ? 'Choose an available sending account' : null);
  const field = (name: 'to' | 'cc' | 'bcc' | 'subject', label: string, placeholder: string) => (
    <label className="flex items-start gap-3 border-b border-border/60 px-4 py-2.5 text-sm">
      <span className="w-12 shrink-0 pt-0.5 text-xs text-muted-foreground">{label}</span>
      <input aria-label={label} name={name} value={draft[name]} disabled={!editable} placeholder={placeholder} autoComplete="off" inputMode={name === 'subject' ? 'text' : 'email'} autoCapitalize={name === 'subject' ? 'sentences' : 'none'} spellCheck={name === 'subject'} maxLength={2000}
        className="min-w-0 flex-1 rounded-sm bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/45 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-80"
        onChange={event => { setMessage(null); editor.change({ [name]: event.target.value }); }} />
    </label>
  );

  if (draft.status === 'discarded' && !hasEdits) return <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Mail size={14} />Email draft discarded</div>;

  return (
    <section aria-labelledby={labelId} className="my-2 w-full overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
        {draft.status === 'sent' ? <Check size={15} className="text-green-600" /> : <Mail size={15} className="text-muted-foreground" />}
        <h3 id={labelId} className="flex-1 text-sm font-medium">{draft.status === 'sent' ? 'Email sent' : draft.status === 'uncertain' ? 'Delivery unconfirmed' : draft.status === 'sending' ? 'Sending email' : draft.status === 'discarded' ? 'Email draft discarded' : 'Email draft'}</h3>
        <span aria-live="polite" className="text-[11px] text-muted-foreground">{save.isPending ? 'Saving…' : hasEdits ? 'Unsaved edits' : draft.status === 'draft' ? 'Saved' : ''}</span>
      </div>
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 text-[13px]">
        <label htmlFor={`${labelId}-from`} className="w-12 shrink-0 text-xs text-muted-foreground">From</label>
        {editable ? <select id={`${labelId}-from`} value={draft.connectionId ?? ''} disabled={accounts.isPending || accounts.isError} className="min-w-0 flex-1 rounded-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50" onChange={event => editor.change({ connectionId: event.target.value || null })}>
          <option value="">{accounts.isPending ? 'Loading accounts…' : 'Choose an account'}</option>
          {draft.connectionId && !accounts.data?.some(account => account.id === draft.connectionId) && <option value={draft.connectionId}>Account unavailable</option>}
          {accounts.data?.map(account => <option key={account.id} value={account.id}>{account.label} ({account.provider === 'google' ? 'Gmail' : 'Outlook'})</option>)}
        </select> : <span>{draft.fromLabel ?? accounts.data?.find(account => account.id === draft.connectionId)?.label ?? 'Selected account'}</span>}
        {editable && <div className="flex gap-2 text-xs text-muted-foreground">
          {!showCc && !draft.cc && <button type="button" onClick={() => setShowCc(true)}>Cc</button>}
          {!showBcc && !draft.bcc && <button type="button" onClick={() => setShowBcc(true)}>Bcc</button>}
        </div>}
      </div>
      {editable && accounts.isError && <p role="alert" className="px-4 py-2 text-xs text-destructive">Could not load accounts. <button type="button" className="underline" onClick={() => void accounts.refetch()}>Try again</button></p>}
      {editable && !accounts.isPending && !accounts.isError && accounts.data?.length === 0 && <p className="px-4 py-2 text-xs text-muted-foreground">Connect Gmail or Outlook in <button type="button" className="underline" onClick={() => openSettings('plugins', { anchor: 'integrations' })}>{INTEGRATION_LABELS.plural}</button> to send this email. You can keep drafting here.</p>}
      {field('to', 'To', 'name@example.com, another@example.com')}
      {(showCc || draft.cc) && field('cc', 'Cc', 'Copy recipients')}
      {(showBcc || draft.bcc) && field('bcc', 'Bcc', 'Hidden recipients')}
      {field('subject', 'Subject', 'Subject')}
      <textarea aria-label="Message" name="body" value={draft.body} disabled={!editable} placeholder="Write your message…" rows={9} maxLength={200_000}
        className="block min-h-48 w-full resize-y bg-transparent px-4 py-4 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-80"
        onChange={event => { setMessage(null); editor.change({ body: event.target.value }); }} />
      {(conflict || save.isError || hasEdits && !save.isPending) && editable && <div role="alert" className="space-y-2 border-t border-border bg-muted/30 px-4 py-3 text-xs">
        <p>{conflict ? 'This draft changed while you were editing. Your edits are kept here.' : save.error?.message ?? 'Your recovered edits are ready to save.'}</p>
        {conflict && <details><summary className="cursor-pointer">Review saved changes</summary><dl className="mt-2 space-y-2">{(Object.keys(edits) as (keyof EmailDraftFields)[]).map(key => <div key={key}><dt className="font-medium">{key === 'connectionId' ? 'Sending account' : key}</dt><dd className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{key === 'connectionId' ? accounts.data?.find(account => account.id === conflict.connectionId)?.label ?? 'No available account' : conflict[key] || '(empty)'}</dd></div>)}</dl></details>}
        <div className="flex gap-3">
          <button type="button" disabled={busy} className="font-medium underline" onClick={() => void editor.resolve(true).catch(error => setMessage(error.message))}>{conflict ? 'Keep my edits' : 'Save edits'}</button>
          <button type="button" disabled={busy} className="text-muted-foreground underline" onClick={() => void editor.resolve(false).catch(error => setMessage(error.message))}>Use saved draft</button>
        </div>
      </div>}
      {hasEdits && draft.status !== 'draft' && <div role="alert" className="space-y-2 border-t border-border px-4 py-3 text-xs">
        <p>This email closed before your local edits were saved. These edits were not sent.</p>
        <details><summary className="cursor-pointer">Your unsent edits</summary><dl className="mt-2 space-y-2">{Object.entries(edits).map(([key, value]) => <div key={key}><dt className="font-medium">{key}</dt><dd className="whitespace-pre-wrap break-words">{value || '(empty)'}</dd></div>)}</dl></details>
        <button type="button" className="text-muted-foreground underline" onClick={() => void editor.resolve(false).catch(error => setMessage(error.message))}>Dismiss unsent edits</button>
      </div>}
      {draft.status !== 'sent' && (message || draft.error) && <p role="alert" className="border-t border-border px-4 py-3 text-xs text-destructive">{message ?? draft.error}</p>}
      {(draft.status === 'sending' || send.isPending) && <p role="status" className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Waiting for delivery confirmation. Check Sent mail if confirmation does not arrive.</p>}
      {draft.status === 'sent' && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Sent{draft.sentAt ? ` on ${new Date(draft.sentAt).toLocaleString()}` : ''}</p>}
      {editable && <div className="flex items-center gap-3 border-t border-border px-4 py-3">
        <Button size="sm" type="button" disabled={busy || hasEdits || Boolean(conflict)} onClick={() => { if (problem) setMessage(problem); else { setMessage(null); send.mutate(); } }}>
          {send.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}Send
        </Button>
        <span className="flex-1 text-[11px] text-muted-foreground">{problem ?? 'Ready to send'}</span>
        <Tip label="Discard this draft"><Button variant="ghost" size="icon-sm" type="button" aria-label="Discard email draft" disabled={busy || hasEdits} onClick={() => discard.mutate()}><Trash2 size={14} /></Button></Tip>
      </div>}
    </section>
  );
}
