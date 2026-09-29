'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Link2, Pencil, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { devicesApi, type DeviceKeyView, type DeviceView, type PairDeviceResponse, type UpdateDeviceBody } from '@/lib/api/devices';
import { settingsApi } from '@/lib/api/settings';
import { useDevices } from '@/hooks/use-devices';
import { PAIRING_TOKEN_FRAGMENT_KEY, APP_NAME, APP_SHORT_ID } from '@/constants/app';
import type { DeviceKind } from '@/db/types';
import { tokenDisplay } from '@/lib/auth/token-display';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { QrCode } from '@/components/settings/qr-code';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { cn } from '@/lib/utils';

const DEVICE_KINDS: { value: DeviceKind; label: string }[] = [
  { value: 'computer', label: 'Computer' },
  { value: 'phone', label: 'Phone' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'service', label: 'Service' },
  { value: 'other', label: 'Other' },
];

const kindLabel = (kind: DeviceKind) => DEVICE_KINDS.find((k) => k.value === kind)?.label ?? kind;

function formatDate(value: string | null | undefined): string {
  if (!value) return 'never';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

/** The most recent of a device's own report and its keys' use. */
function lastActive(device: DeviceView): string | null {
  const times = [device.lastSeenAt, ...device.keys.map((k) => k.lastUsedAt)].filter((t): t is string => !!t);
  return times.sort().at(-1) ?? null;
}

/**
 * Settings, Devices: everything that reaches this Ri, each device once
 * (docs/homes-spec.md §5.1). What it is, whether it runs agents, and the
 * keys it signs in with. Pairing adds a device with its first key, and a
 * device already here can get another pairing link.
 */
export function DevicesSection() {
  const queryClient = useQueryClient();
  const { data: devices, isLoading } = useDevices();
  const { data: baseUrls } = useQuery({
    queryKey: ['settings', 'base-url'],
    queryFn: () => settingsApi.getBaseUrls(),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('phone');
  // A new device's link shows by the form it came from. Another link for a
  // device already here shows in that device's card.
  const [pairing, setPairing] = useState<{ res: PairDeviceResponse; inCard: boolean } | null>(null);
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['devices'] }), [queryClient]);

  const pairMutation = useMutation({
    mutationFn: (input: { name: string; kind: DeviceKind }) => devicesApi.pair(input),
    onSuccess: (res) => {
      setPairing({ res, inCard: false });
      setName('');
      setFormOpen(false);
      void refresh();
    },
  });

  const addKeyMutation = useMutation({
    mutationFn: (id: string) => devicesApi.addKey(id),
    onSuccess: (res) => {
      setPairing({ res, inCard: true });
      setFormOpen(false);
      void refresh();
    },
  });

  const handlePair = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    pairMutation.mutate({ name: trimmed, kind });
  }, [pairMutation, name, kind]);

  // Home first, then the rest as they were added.
  const listed = useMemo(
    () => [...(devices ?? [])].sort((a, b) => Number(b.isHome) - Number(a.isHome)),
    [devices],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Devices</h3>
        </div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setFormOpen((v) => !v);
            setPairing(null);
          }}
        >
          <Plus size={12} />
          Add device
        </Button>
      </div>

      {formOpen && (
        <div className="rounded-lg border border-border bg-background p-3 space-y-2">
          <label className="block">
            <span className="text-[11px] text-muted-foreground/70">Name</span>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="iPhone 15"
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePair();
              }}
            />
          </label>
          <KindSelect value={kind} onChange={setKind} />
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={handlePair} disabled={!name.trim() || pairMutation.isPending}>
              {pairMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              Create pairing link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </div>
          {pairMutation.isError && (
            <p className="text-[11px] text-destructive">Couldn&apos;t add the device. Try again.</p>
          )}
        </div>
      )}

      {pairing && !pairing.inCard && <PairingPanel pairing={pairing.res} baseUrls={baseUrls} onDone={() => setPairing(null)} />}

      <div className="space-y-2">
        {isLoading && <SettingsSkeleton rows={2} />}
        {!isLoading && listed.length === 0 && (
          <p className="text-[11px] text-muted-foreground/60">No devices yet.</p>
        )}
        {listed.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            onChanged={refresh}
            onPairAgain={() => addKeyMutation.mutate(d.id)}
            pairingAgain={addKeyMutation.isPending && addKeyMutation.variables === d.id}
            pairing={
              pairing?.inCard && pairing.res.device.id === d.id ? (
                <PairingPanel pairing={pairing.res} baseUrls={baseUrls} onDone={() => setPairing(null)} />
              ) : null
            }
          />
        ))}
      </div>
    </div>
  );
}

function KindSelect({ value, onChange }: { value: DeviceKind; onChange: (kind: DeviceKind) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground/70">Type</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DeviceKind)}
        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {DEVICE_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The pairing link for a device's new key, at each address the home knows. Shown once. */
function PairingPanel({
  pairing,
  baseUrls,
  onDone,
}: {
  pairing: PairDeviceResponse;
  baseUrls: { tunnel?: string | null; lan?: string | null } | undefined;
  onDone: () => void;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const handleCopy = useCallback(async (label: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  // Tabs from the base URLs the server knows, deduped (e.g. a browser already
  // on the LAN address). Remote first when there is one, else this address.
  const pairingTabs = useMemo(() => {
    const token = pairing.plaintext;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const norm = (u: string) => u.replace(/\/+$/, '');

    const candidates: Array<{ id: string; label: string; base: string; hint: string }> = [];
    if (baseUrls?.tunnel) {
      candidates.push({ id: 'remote', label: 'Remote', base: baseUrls.tunnel, hint: 'Off-network: anywhere with internet' });
    }
    if (origin) {
      candidates.push({ id: 'current', label: 'This address', base: origin, hint: 'The address this browser is using' });
    }
    if (baseUrls?.lan) {
      candidates.push({ id: 'lan', label: 'Same network', base: baseUrls.lan, hint: 'Any device on the same Wi-Fi or LAN' });
    }

    const seen = new Set<string>();
    const tabs = candidates
      .filter((c) => {
        const key = norm(c.base);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((c) => ({ ...c, url: `${norm(c.base)}/#${PAIRING_TOKEN_FRAGMENT_KEY}=${token}` }));

    const defaultValue =
      tabs.find((t) => t.id === 'remote')?.id ?? tabs.find((t) => t.id === 'current')?.id ?? tabs[0]?.id ?? '';
    return { tabs, defaultValue };
  }, [pairing, baseUrls]);

  if (pairingTabs.tabs.length === 0) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">Pairing link for {pairing.device.name}</p>
          <p className="text-[11px] text-muted-foreground/70">Shown once. Scan or copy it on that device.</p>
          <p className="text-[11px] text-muted-foreground/70">
            A phone or computer reaches {APP_NAME} through its home, at the address in the link. It works while the
            home is awake and that address is reachable. On a computer, paste the link into{' '}
            <code className="font-mono text-foreground/80">{APP_SHORT_ID} connect</code> to use this {APP_NAME} there.
          </p>
        </div>
        <Button size="xs" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      <Tabs defaultValue={pairingTabs.defaultValue}>
        <TabsList>
          {pairingTabs.tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {pairingTabs.tabs.map((t) => (
          <TabsContent key={t.id} value={t.id} className="mt-3">
            <p className="text-[11px] text-muted-foreground/70 mb-2">{t.hint}</p>
            <div className="flex gap-3 items-start">
              <QrCode value={t.url} size={140} />
              <div className="flex-1 min-w-0 space-y-2">
                <input
                  readOnly
                  value={t.url}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button size="sm" variant="outline" onClick={() => handleCopy(t.id, t.url)}>
                  {copiedLabel === t.id ? <Check size={12} /> : <Copy size={12} />}
                  {copiedLabel === t.id ? 'Copied' : 'Copy URL'}
                </Button>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* The raw token, the same for every URL above: for a device that
          already has Ri open, or a paste target that drops the fragment. */}
      <div className="pt-3 border-t border-primary/20 space-y-1.5">
        <p className="text-[11px] text-muted-foreground/70">
          Or paste just the token into any base URL as{' '}
          <code className="font-mono text-foreground/80">/#{PAIRING_TOKEN_FRAGMENT_KEY}=&lt;token&gt;</code>.
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={pairing.plaintext}
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button size="sm" variant="outline" onClick={() => handleCopy('token', pairing.plaintext)}>
            {copiedLabel === 'token' ? <Check size={12} /> : <Copy size={12} />}
            {copiedLabel === 'token' ? 'Copied' : 'Copy token'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Marker({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'agents' }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'agents'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** What a worker last said, for a device that runs agents. */
function workerLine(device: DeviceView): string | null {
  if (!device.worker?.enrolled) return null;
  if (device.worker.connected) return 'Connected';
  if (device.worker.reportedState === 'asleep') return 'Asleep';
  return `Not connected, last seen ${formatDate(device.lastSeenAt)}`;
}

function DeviceCard({
  device,
  onChanged,
  onPairAgain,
  pairingAgain,
  pairing,
}: {
  device: DeviceView;
  onChanged: () => void;
  onPairAgain: () => void;
  pairingAgain: boolean;
  /** Its new pairing link, while it's shown. */
  pairing: React.ReactNode;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(device.name);
  const [draftKind, setDraftKind] = useState<DeviceKind>(device.kind);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateDeviceBody) => devicesApi.update(device.id, input),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: () => setError("Couldn't save. Try again."),
  });
  const removeMutation = useMutation({
    mutationFn: () => devicesApi.remove(device.id),
    onSuccess: onChanged,
  });
  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => devicesApi.revokeKey(device.id, keyId),
    onSuccess: onChanged,
  });

  const beginEdit = () => {
    setDraftName(device.name);
    setDraftKind(device.kind);
    setError(null);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    const patch: UpdateDeviceBody = {};
    if (trimmed !== device.name) patch.name = trimmed;
    if (draftKind !== device.kind) patch.kind = draftKind;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setError(null);
    updateMutation.mutate(patch);
  };

  const remove = async () => {
    const yes = await confirm({
      title: `Remove ${device.name}?`,
      description: device.runsAgents
        ? 'Its keys stop working and it stops running agents. Work under way there ends. To use it again, pair it again.'
        : 'Its keys stop working. Whatever signed in with them has to pair again.',
      confirmLabel: 'Remove',
      tone: 'destructive',
    });
    if (yes) removeMutation.mutate();
  };

  const revoke = async (key: DeviceKeyView) => {
    const yes = await confirm(
      key.role === 'worker'
        ? {
            title: `Stop running agents on ${device.name}?`,
            description: `Its worker stops, and work under way there ends. To turn it on again, run ${APP_SHORT_ID} worker enroll there.`,
            confirmLabel: 'Stop running agents',
            tone: 'destructive',
          }
        : {
            title: `Revoke ${key.name}?`,
            description: key.current
              ? 'This browser signs in with it, so it signs out right away.'
              : 'Whatever signs in with it stops reaching your Ri: a browser, the phone app or the CLI.',
            confirmLabel: 'Revoke',
            tone: 'destructive',
          },
    );
    if (yes) revokeMutation.mutate(key.id);
  };

  const status = workerLine(device);

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2.5">
      {editing ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-[11px] text-muted-foreground/70">Name</span>
            <input
              autoFocus
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          </label>
          <KindSelect value={draftKind} onChange={setDraftKind} />
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={commitEdit} disabled={updateMutation.isPending || !draftName.trim()}>
              {updateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={updateMutation.isPending}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium text-foreground truncate">{device.name}</p>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{kindLabel(device.kind)}</span>
              {device.isHome && <Marker tone="agents">Home, runs agents</Marker>}
              {!device.isHome && device.runsAgents && <Marker tone="agents">Runs agents</Marker>}
              {device.isThisDevice && <Marker>This device</Marker>}
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              {status ?? `Last active ${formatDate(lastActive(device))}`}
            </p>
            {device.isHome && device.portable && (
              <p className="text-[11px] text-muted-foreground/60">A laptop, so schedules run while it&apos;s awake.</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="xs" variant="ghost" onClick={onPairAgain} disabled={pairingAgain} aria-label={`New pairing link for ${device.name}`} title="New pairing link">
              {pairingAgain ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            </Button>
            <Button size="xs" variant="ghost" onClick={beginEdit} aria-label={`Edit ${device.name}`} title="Edit">
              <Pencil size={12} />
            </Button>
            {!device.isHome && (
              <Button size="xs" variant="ghost" onClick={remove} disabled={removeMutation.isPending} aria-label={`Remove ${device.name}`} title="Remove">
                {removeMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </Button>
            )}
          </div>
        </div>
      )}

      {pairing}

      {device.keys.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60">No keys. A new pairing link signs it in again.</p>
      ) : (
        <ul className="space-y-1 border-t border-border/60 pt-2">
          {device.keys.map((k) => (
            <KeyRow
              key={k.id}
              keyView={k}
              onRevoke={() => revoke(k)}
              revoking={revokeMutation.isPending && revokeMutation.variables === k.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<DeviceKeyView['role'], string | null> = {
  home: "Ri's own",
  worker: 'Worker',
  'sign-in': null,
};

function KeyRow({ keyView, onRevoke, revoking }: { keyView: DeviceKeyView; onRevoke: () => void; revoking: boolean }) {
  const role = ROLE_LABEL[keyView.role];
  return (
    <li className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-foreground/90 truncate">{keyView.name}</span>
          {role && <Marker>{role}</Marker>}
          {keyView.current && <Marker>This browser</Marker>}
        </div>
        <p className="text-[11px] text-muted-foreground/60 font-mono truncate">
          {tokenDisplay(keyView.prefix, keyView.suffix, keyView.env)}
          <span className="font-sans"> · last used {formatDate(keyView.lastUsedAt)}</span>
        </p>
      </div>
      {keyView.role !== 'home' && (
        <Button size="xs" variant="ghost" onClick={onRevoke} disabled={revoking} aria-label={`Revoke ${keyView.name}`} title="Revoke">
          {revoking ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={12} />}
        </Button>
      )}
    </li>
  );
}
