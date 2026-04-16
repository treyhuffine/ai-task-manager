'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { devicesApi, type CreateDeviceResponse } from '@/lib/api/devices';
import type { ApiKeyRecord, DeviceType } from '@/db/types';
import { tokenDisplay } from '@/lib/auth/tokens';
import { Button } from '@/components/ui/button';

const DEVICE_TYPES: DeviceType[] = ['laptop', 'desktop', 'phone', 'tablet', 'cli', 'other'];

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

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('phone');
  const [lastCreated, setLastCreated] = useState<CreateDeviceResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: (input: { name: string; device_type: DeviceType }) =>
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

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed, device_type: deviceType });
  }, [createMutation, name, deviceType]);

  const handleCopy = useCallback(async () => {
    if (!lastCreated) return;
    try {
      await navigator.clipboard.writeText(lastCreated.pairingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [lastCreated]);

  const active = useMemo(
    () => (devices ?? []).filter((d) => !d.revoked_at),
    [devices],
  );

  return (
    <div className="space-y-4">
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

      {lastCreated && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">
            Pairing URL for &ldquo;{lastCreated.key.name}&rdquo;
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            This is shown once. Copy it and open it on the target device.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={lastCreated.pairingUrl}
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" variant="outline" onClick={handleCopy}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {isLoading && (
          <p className="text-[11px] text-muted-foreground/60">Loading devices…</p>
        )}
        {!isLoading && active.length === 0 && (
          <p className="text-[11px] text-muted-foreground/60">No paired devices.</p>
        )}
        {active.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            onRevoke={() => revokeMutation.mutate(d.id)}
            revoking={revokeMutation.isPending && revokeMutation.variables === d.id}
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
}: {
  device: ApiKeyRecord;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const display = tokenDisplay(device.prefix, device.suffix, device.env);
  return (
    <div className="rounded-lg border border-border bg-background p-3 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{device.name}</p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {device.device_type}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/70 font-mono truncate">{display}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          Last used {formatDate(device.last_used_at)}
        </p>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1">
          <Button size="xs" variant="destructive" onClick={onRevoke} disabled={revoking}>
            {revoking ? <Loader2 size={10} className="animate-spin" /> : null}
            Revoke
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setConfirming(true)}
          aria-label="Revoke device"
        >
          <Trash2 size={12} />
        </Button>
      )}
    </div>
  );
}
