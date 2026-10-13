'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiErrorText } from '@/lib/api/client';
import { tunnelHostPreview } from '@/lib/auth/tunnel-host';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { GateButton, GateField, GateNotice } from './team-gate';

/** First setup saves a prefix. Remote access is an explicit choice in Settings. */
export function TeamAddressSetup({ onSaved, onDone }: { onSaved?: () => void; onDone?: () => void }) {
  const address = useQuery(trpc.team.address.get.queryOptions());
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [method, setMethod] = useState<'custom' | 'beamd' | null>(null);
  const data = address.data;
  const name = nameDraft ?? (data?.address || data?.nameLocked ? data?.tunnelName : data?.suggestedName) ?? '';
  const normalizedName = name.trim().toLowerCase();
  const preview = data?.autoTunnel ? tunnelHostPreview(data.address, data.tunnelName, normalizedName) : null;
  const saved = async () => {
    await address.refetch();
    setNameDraft(null);
    onSaved?.();
  };
  const prefix = useMutation({
    mutationFn: () => trpcClient.team.address.savePrefix.mutate({ name: normalizedName }),
    meta: { carriesInput: true },
    onSuccess: async () => { await saved(); onDone?.(); },
  });
  const beamd = useMutation({
    mutationFn: () => trpcClient.team.address.configureBeamd.mutate({ name: normalizedName }),
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
            <p className="text-muted-foreground">Remote access is already configured. You can change the team address in Settings.</p>
            <GateButton onClick={onDone}>Continue to team</GateButton>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">Choose a short name to use when you set up a remote address. You can change it later.</p>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && isValidPreviewLabel(normalizedName)) prefix.mutate(); }}>
              {prefixField}
              <p className="text-xs text-muted-foreground">To invite people or connect from another device, choose how to make the team reachable in Settings → Where people reach the team.</p>
              {prefix.error && <GateNotice tone="error">{apiErrorText(prefix.error)}</GateNotice>}
              <GateButton type="submit" busy={prefix.isPending} disabled={busy || !isValidPreviewLabel(normalizedName)}>Save and continue</GateButton>
            </form>
            <button type="button" className="w-full rounded-md border border-border px-3 py-2 text-sm" disabled={busy} onClick={onDone}>Decide later</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {data.address ? 'Use this address to reach your team from another device.' : 'Set up a remote address before inviting people, signing in on another device or connecting your personal Ri. A localhost link only works on the computer hosting the team.'}
      </p>
      {data.address && <p className="break-words font-medium" role="status">{data.address}</p>}
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Remote access method">
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
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && isValidPreviewLabel(normalizedName)) beamd.mutate(); }}>
          {prefixField}
          <p className="break-words text-xs text-muted-foreground">
            {preview ? `Expected address: ${preview}` : 'Uses the Beamd account connected on the hosting computer. Beamd adds its account and domain suffix to the prefix.'}
          </p>
          {data.address && normalizedName !== data.tunnelName && <p className="text-xs text-muted-foreground">After changing the address, use new sign-in and invitation links. Personal Homes already connected may need to reconnect at the new address.</p>}
          <p className="text-xs text-muted-foreground">Ri keeps this address connected while the hosting computer is running. People still need an invitation or sign-in link to access the team.</p>
          {beamd.error && <GateNotice tone="error">{apiErrorText(beamd.error)}</GateNotice>}
          <GateButton type="submit" busy={beamd.isPending} disabled={busy || !isValidPreviewLabel(normalizedName)}>Use Beamd address</GateButton>
        </form>
      )}
    </div>
  );
}
