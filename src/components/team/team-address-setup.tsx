'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiErrorText } from '@/lib/api/client';
import { tunnelHostPreview } from '@/lib/auth/tunnel-host';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { GateButton, GateField, GateNotice } from './team-gate';

/** Shared by the owner's first setup and the team's address settings. */
export function TeamAddressSetup({ onSaved, onDone }: { onSaved?: () => void; onDone?: () => void }) {
  const address = useQuery(trpc.team.address.get.queryOptions());
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const data = address.data;
  const name = nameDraft ?? (data?.address || data?.nameLocked ? data?.tunnelName : data?.suggestedName) ?? '';
  const normalizedName = name.trim().toLowerCase();
  const preview = tunnelHostPreview(data?.address, data?.tunnelName, normalizedName);
  const saved = async () => {
    await address.refetch();
    setNameDraft(null);
    onSaved?.();
  };
  const beamd = useMutation({
    mutationFn: () => trpcClient.team.address.configureBeamd.mutate({ name: normalizedName }),
    onSuccess: saved,
  });
  const custom = useMutation({
    mutationFn: () => trpcClient.team.address.set.mutate({ address: customUrl.trim() }),
    onSuccess: async () => { setCustomUrl(''); await saved(); },
  });
  const busy = beamd.isPending || custom.isPending;

  if (address.isLoading) return <p className="text-sm text-muted-foreground">Checking the team address…</p>;
  if (!data) return <GateNotice tone="error">Could not load the team address. <button type="button" className="underline" onClick={() => void address.refetch()}>Retry</button></GateNotice>;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {data.address ? 'Use this address to reach your team from another device.' : 'Set up a remote address before inviting people, signing in on another device or connecting your personal Ri. A localhost link only works on the computer hosting the team.'}
      </p>
      {data.address && <p className="break-words font-medium" role="status">{data.address}</p>}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && isValidPreviewLabel(normalizedName)) beamd.mutate(); }}>
        <GateField
          id="team-address-prefix"
          label="Address prefix"
          hint={data.nameLocked ? 'This prefix is controlled by the hosting computer.' : 'Choose a memorable name. Use letters, numbers and hyphens.'}
          value={name}
          onChange={(e) => { setNameDraft(e.target.value); beamd.reset(); }}
          disabled={busy || data.nameLocked}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_LABEL_LENGTH}
        />
        {name && !isValidPreviewLabel(normalizedName) && <GateNotice tone="error">Start and end with a letter or number. Use only letters, numbers and hyphens.</GateNotice>}
        <p className="break-words text-xs text-muted-foreground">
          {preview ? `Expected address: ${preview}` : 'Beamd adds its account and domain suffix. The full address appears here after setup.'}
        </p>
        {data.address && normalizedName !== data.tunnelName && <p className="text-xs text-muted-foreground">After changing the address, use new sign-in and invitation links. Personal Homes already connected may need to reconnect at the new address.</p>}
        <p className="text-xs text-muted-foreground">Ri keeps this address connected while the hosting computer is running. People still need an invitation or sign-in link to access the team.</p>
        {beamd.error && <GateNotice tone="error">{apiErrorText(beamd.error)}</GateNotice>}
        <GateButton type="submit" busy={beamd.isPending} disabled={busy || !isValidPreviewLabel(normalizedName)}>
          {data.address ? 'Use Beamd address' : 'Set up with Beamd'}
        </GateButton>
      </form>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Use an address I already have</summary>
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy && customUrl.trim()) custom.mutate(); }}>
          <GateField id="team-custom-address" label="Team address" placeholder="https://team.example.com" value={customUrl} onChange={(e) => { setCustomUrl(e.target.value); custom.reset(); }} disabled={busy} />
          {custom.error && <GateNotice tone="error">{apiErrorText(custom.error)}</GateNotice>}
          <GateButton type="submit" busy={custom.isPending} disabled={busy || !customUrl.trim()}>Use this address</GateButton>
        </form>
      </details>
      {onDone && <button type="button" className="w-full rounded-md border border-border px-3 py-2 text-sm" disabled={busy} onClick={onDone}>{data.address ? 'Continue to team' : 'Use only on this computer for now'}</button>}
    </div>
  );
}
