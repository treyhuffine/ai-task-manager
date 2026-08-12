'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus, Trash2, Check, Loader2, X } from 'lucide-react';
import { devicesApi, type CreateDeviceResponse, type UpdateDeviceBody } from '@/lib/api/devices';
import { settingsApi } from '@/lib/api/settings';
import { PAIRING_TOKEN_FRAGMENT_KEY } from '@/constants/app';
import type { ApiKeyRecord, DeviceType } from '@/db/types';
import { tokenDisplay } from '@/lib/auth/token-display';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QrCode } from '@/components/settings/qr-code';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';

const DEVICE_TYPES: DeviceType[] = ['computer', 'phone', 'tablet', 'service', 'other'];

function formatDate(value: string | null | undefined): string {
  if (!value) return 'never';
  try {
    const d = new Date(value);
    return d.toLocaleString();
  } catch {
    return value;
  }
}

export function DevicesSection() {
  const queryClient = useQueryClient();
  const { data: devices, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesApi.list(),
  });

  const { data: baseUrls } = useQuery({
    queryKey: ['settings', 'base-url'],
    queryFn: () => settingsApi.getBaseUrls(),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('phone');
  const [lastCreated, setLastCreated] = useState<CreateDeviceResponse | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (input: { name: string; deviceType: DeviceType }) =>
      devicesApi.create(input),
    onSuccess: (res) => {
      setLastCreated(res);
      setName('');
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => devicesApi.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeviceBody }) =>
      devicesApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed, deviceType: deviceType });
  }, [createMutation, name, deviceType]);

  const handleCopy = useCallback(async (label: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  // Build tab entries from server-known base URLs. Dedupe (e.g. if user is
  // already on the LAN IP, the "current" URL == LAN URL). Default tab =
  // remote when available, else whatever this browser is on.
  const pairingTabs = useMemo(() => {
    if (!lastCreated) return { tabs: [], defaultValue: '' };
    const token = lastCreated.plaintext;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const norm = (u: string) => u.replace(/\/+$/, '');

    const candidates: Array<{ id: string; label: string; base: string; hint: string }> = [];
    if (baseUrls?.tunnel) {
      candidates.push({
        id: 'remote',
        label: 'Remote',
        base: baseUrls.tunnel,
        hint: 'Off-network: anywhere with internet',
      });
    }

    if (origin) {
      candidates.push({
        id: 'current',
        label: 'This computer',
        base: origin,
        hint: 'The URL you are currently connected to',
      });
    }

    if (baseUrls?.lan) {
      candidates.push({
        id: 'lan',
        label: 'Same network',
        base: baseUrls.lan,
        hint: 'Any device on the same Wi-Fi / LAN',
      });
    }

    // Dedupe by normalized base URL (preserve first occurrence / order).
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
      tabs.find((t) => t.id === 'remote')?.id ??
      tabs.find((t) => t.id === 'current')?.id ??
      tabs[0]?.id ??
      '';

    return { tabs, defaultValue };
  }, [lastCreated, baseUrls]);

  const active = useMemo(
    () => (devices ?? []).filter((d) => !d.revokedAt),
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
            setLastCreated(null);
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
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground/70">Device type</span>
            <select
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value as DeviceType)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {DEVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </div>
          {createMutation.isError && (
            <p className="text-[11px] text-destructive">
              Failed to create device. Try again.
            </p>
          )}
        </div>
      )}

      {lastCreated && pairingTabs.tabs.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-foreground">
              Pairing URL for &ldquo;{lastCreated.key.name}&rdquo;
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Shown once. Scan or copy on the target device.
            </p>
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

          {/* Raw token — same for every URL above. Useful when pasting into
              a device that already has flow open, or when the pairing URL's
              hash fragment isn't preserved across the paste target. */}
          <div className="pt-3 border-t border-primary/20 space-y-1.5">
            <p className="text-[11px] text-muted-foreground/70">
              Or paste just the token into any base URL as{' '}
              <code className="font-mono text-foreground/80">/#{PAIRING_TOKEN_FRAGMENT_KEY}=&lt;token&gt;</code>.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={lastCreated.plaintext}
                className="flex-1 min-w-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCopy('token', lastCreated.plaintext)}
              >
                {copiedLabel === 'token' ? <Check size={12} /> : <Copy size={12} />}
                {copiedLabel === 'token' ? 'Copied' : 'Copy token'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading && <SettingsSkeleton rows={2} />}
        {!isLoading && active.length === 0 && (
          <p className="text-[11px] text-muted-foreground/60">No paired devices.</p>
        )}
        {active.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            onRevoke={() => revokeMutation.mutate(d.id)}
            revoking={revokeMutation.isPending && revokeMutation.variables === d.id}
            onSave={(input) =>
              updateMutation.mutateAsync({ id: d.id, input }).then(() => undefined)
            }
          />
        ))}
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  onRevoke,
  revoking,
  onSave,
}: {
  device: ApiKeyRecord;
  onRevoke: () => void;
  revoking: boolean;
  onSave: (input: UpdateDeviceBody) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(device.name);
  const [draftType, setDraftType] = useState<DeviceType>(device.deviceType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const display = tokenDisplay(device.prefix, device.suffix, device.env);

  const beginEdit = () => {
    setDraftName(device.name);
    setDraftType(device.deviceType);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const commitEdit = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    const patch: UpdateDeviceBody = {};
    if (trimmed !== device.name) patch.name = trimmed;
    if (draftType !== device.deviceType) patch.deviceType = draftType;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(patch);
      setEditing(false);
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
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
              if (e.key === 'Escape') cancelEdit();
            }}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground/70">Device type</span>
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as DeviceType)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-muted-foreground/60 font-mono truncate">{display}</p>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={commitEdit} disabled={saving || !draftName.trim()}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{device.name}</p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {device.deviceType}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/70 font-mono truncate">{display}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          Last used {formatDate(device.lastUsedAt)}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1">
          <Button size="xs" variant="destructive" onClick={onRevoke} disabled={revoking}>
            {revoking ? <Loader2 size={10} className="animate-spin" /> : null}
            Revoke
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setConfirming(false)}
            aria-label="Cancel revoke"
          >
            <X size={12} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={beginEdit} aria-label="Edit device">
            <Pencil size={12} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label="Revoke device"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      )}
    </div>
  );
}
