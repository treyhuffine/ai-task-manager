'use client';

import { useState } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiErrorText } from '@/lib/api/client';
import { tunnelHostPreview } from '@/lib/auth/tunnel-host';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { GateButton, GateField, GateNotice } from './team-gate';

/** First setup saves a prefix. A Team address is enabled by an explicit choice. */
export function TeamAddressSetup({ onSaved, onDone }: { onSaved?: () => void; onDone?: () => void }) {
  const address = useQuery(trpc.team.address.get.queryOptions());
  const connection = useQuery({ ...trpc.team.address.status.queryOptions(), enabled: !onDone, staleTime: 30_000, retry: false });
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [method, setMethod] = useState<'custom' | 'beamd' | null>(null);
  const [editing, setEditing] = useState(false);
  const data = address.data;
  const name = nameDraft ?? (data?.address || data?.nameLocked ? data?.tunnelName : data?.suggestedName) ?? '';
  const normalizedName = name.trim().toLowerCase();
  const preview = data?.autoTunnel ? tunnelHostPreview(data.address, data.tunnelName, normalizedName) : null;
  const saved = async () => {
    await address.refetch();
    if (!onDone) await connection.refetch();
    setNameDraft(null);
    setEditing(false);
    setMethod(null);
    onSaved?.();
  };
  const prefix = useMutation({
    mutationFn: () => trpcClient.team.address.savePrefix.mutate({ name: normalizedName }),
    meta: { carriesInput: true },
    onSuccess: async () => { await saved(); onDone?.(); },
  });
  const beamd = useMutation({
    mutationFn: (name: string) => trpcClient.team.address.configureBeamd.mutate({ name }),
    onSuccess: saved,
  });
  const custom = useMutation({
    mutationFn: () => trpcClient.team.address.set.mutate({ address: customUrl.trim() }),
    onSuccess: async () => { setCustomUrl(''); await saved(); },
  });
  const busy = prefix.isPending || beamd.isPending || custom.isPending;

  if (address.isLoading) return <p className="text-sm text-muted-foreground">Checking the team address…</p>;
  if (!data) return <GateNotice tone="error">Could not load the team address. <button type="button" className="underline" onClick={() => void address.refetch()}>Retry</button></GateNotice>;
  const prefixField = (
    <>
      <GateField
        id="team-address-prefix"
        label="Team prefix"
        hint={data.nameLocked ? 'This prefix is controlled by the hosting computer.' : 'Choose a memorable name. Use letters, numbers and hyphens.'}
        value={name}
        onChange={(e) => { setNameDraft(e.target.value); prefix.reset(); beamd.reset(); }}
        disabled={busy || data.nameLocked}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={MAX_LABEL_LENGTH}
      />
      {name && !isValidPreviewLabel(normalizedName) && <GateNotice tone="error">Start and end with a letter or number. Use only letters, numbers and hyphens.</GateNotice>}
    </>
  );

  if (onDone) {
    return (
      <div className="space-y-4 text-sm">
        {data.address || data.autoTunnel ? (
          <>
            <p className="text-muted-foreground">A Team address is already saved. You can check or change it in Settings, Team address.</p>
            <GateButton onClick={onDone}>Continue to team</GateButton>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">Choose a short name to use when you set up a remote address. You can change it later.</p>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && isValidPreviewLabel(normalizedName)) prefix.mutate(); }}>
              {prefixField}
              <p className="text-xs text-muted-foreground">To invite people or connect from another device, set up Team address in Settings. You can also do this when connecting to My Ri.</p>
              {prefix.error && <GateNotice tone="error">{apiErrorText(prefix.error)}</GateNotice>}
              <GateButton type="submit" busy={prefix.isPending} disabled={busy || !isValidPreviewLabel(normalizedName)}>Save and continue</GateButton>
            </form>
            <button type="button" className="w-full rounded-md border border-border px-3 py-2 text-sm" disabled={busy} onClick={onDone}>Decide later</button>
          </>
        )}
      </div>
    );
  }

  const checked = connection.data?.address === data.address ? connection.data : null;
  const checking = connection.isFetching || (!checked && !connection.isError);
  const online = !connection.isError && checked?.status === 'online';
  const StatusIcon = checking ? LoaderCircle : online ? CircleCheck : CircleAlert;
  const showMethods = !data.address || editing;
  const check = async () => {
    const result = await connection.refetch();
    if (!result.isError && result.data?.status === 'online') onSaved?.();
  };

  return (
    <div className="space-y-4 text-sm">
      {(data.address || !onSaved) && <div className="space-y-3 rounded-lg border border-border p-3">
        <div role="status" className="space-y-1">
          <p className="flex items-center gap-2 font-medium">
            {data.address && <StatusIcon size={15} className={checking ? 'animate-spin text-muted-foreground' : online ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} />}
            {!data.address ? 'Not set up' : checking ? 'Checking connection…' : online ? 'Online' : connection.isError ? 'Could not check connection' : 'Not reachable'}
          </p>
          {data.address ? <>
            <a href={data.address} target="_blank" rel="noopener noreferrer" className="block break-all text-primary underline underline-offset-2">{data.address}</a>
            <p className="text-xs text-muted-foreground">{data.autoTunnel ? 'Beamd address' : 'HTTPS address'}{online && ' · Verified that this address reaches your team.'}</p>
            {!checking && checked?.status === 'offline' && <p className="text-xs text-muted-foreground">{checked.message} The team is still available on its hosting computer.</p>}
            {checked && !checking && <p className="text-[11px] text-muted-foreground">Checked at {new Date(checked.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
          </> : <p className="text-xs text-muted-foreground">Choose an address to invite people, sign in on another device or connect to My Ri. A localhost address only works on the hosting computer.</p>}
        </div>
        {data.address && <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50" disabled={busy || checking} onClick={() => void check()}>Check connection</button>
          {data.autoTunnel && <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50" disabled={busy} onClick={() => beamd.mutate(data.tunnelName)}>{beamd.isPending ? 'Reconnecting…' : 'Reconnect Beamd'}</button>}
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50" disabled={busy} onClick={() => { setEditing(!editing); setMethod(null); }}>{editing ? 'Cancel change' : 'Change address'}</button>
        </div>}
        {beamd.error && !showMethods && <GateNotice tone="error">{apiErrorText(beamd.error)}</GateNotice>}
      </div>}
      {showMethods && <>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Team address method">
        <button type="button" aria-pressed={method === 'custom'} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm aria-pressed:bg-muted" onClick={() => setMethod('custom')}>Use an HTTPS address</button>
        <button type="button" aria-pressed={method === 'beamd'} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm aria-pressed:bg-muted" onClick={() => setMethod('beamd')}>Use Beamd</button>
      </div>
      {method === 'custom' && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && customUrl.trim()) custom.mutate(); }}>
          <p className="text-xs text-muted-foreground">Point your domain, tunnel or private network HTTPS address at this team, then enter it here. Ri checks that it reaches this team before saving.</p>
          <GateField id="team-custom-address" label="Team address" placeholder="https://team.example.com" value={customUrl} onChange={(e) => { setCustomUrl(e.target.value); custom.reset(); }} disabled={busy} />
          {custom.error && <GateNotice tone="error">{apiErrorText(custom.error)}</GateNotice>}
          <GateButton type="submit" busy={custom.isPending} disabled={busy || !customUrl.trim()}>Use this address</GateButton>
        </form>
      )}
      {method === 'beamd' && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && isValidPreviewLabel(normalizedName)) beamd.mutate(normalizedName); }}>
          {prefixField}
          <p className="break-words text-xs text-muted-foreground">
            {preview ? `Expected address: ${preview}` : onSaved ? 'Beamd uses the account signed in on the hosting computer.' : 'Uses the Beamd account connected on the hosting computer. Beamd adds its account and domain suffix to the prefix.'}
          </p>
          {data.address && normalizedName !== data.tunnelName && <p className="text-xs text-muted-foreground">After changing the address, use new sign-in and invitation links. A personal Ri already connected to the team may need to reconnect at the new address.</p>}
          <p className="text-xs text-muted-foreground">Ri keeps this address connected while the hosting computer is running. People still need an invitation or sign-in link to access the team.</p>
          {beamd.error && <GateNotice tone="error">{apiErrorText(beamd.error)}</GateNotice>}
          <GateButton type="submit" busy={beamd.isPending} disabled={busy || !isValidPreviewLabel(normalizedName)}>Use Beamd address</GateButton>
        </form>
      )}
      </>}
    </div>
  );
}
