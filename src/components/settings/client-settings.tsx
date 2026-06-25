'use client';

import { useEffect, useState } from 'react';
import { Laptop } from 'lucide-react';
import { useClientLocation, isHostnameClaimed, setHostnameClaim } from '@/hooks/use-client-location';
import { useHostInfo } from '@/hooks/use-host-info';
import { cn } from '@/lib/utils';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * This browser's relationship to the host machine: whether it's running on the
 * host or as a remote client, plus an override that claims a given hostname
 * (Tailscale magic DNS, LAN IP, etc.) as "my main machine" so host-only
 * affordances (Reveal in Finder, Open in editor) appear. Stored in this
 * origin's localStorage — different machines keep different state.
 *
 * (Editor + chat-density preferences moved to the General settings section.)
 */
export function ClientSettings() {
  const location = useClientLocation();
  const hostInfo = useHostInfo();

  const hostname = location.hostname;
  const isLoopback = LOOPBACK_HOSTS.has(hostname);

  // Track the claim toggle locally so it reflects immediately, then
  // re-syncs from storage on remount.
  const [claimed, setClaimed] = useState(false);
  useEffect(() => {
    setClaimed(isHostnameClaimed(hostname));
  }, [hostname]);

  function toggleClaim() {
    const next = !claimed;
    setClaimed(next);
    setHostnameClaim(hostname, next);
  }

  return (
    <section className="space-y-4 text-[12px]">
      <header className="flex items-center gap-2 text-foreground">
        <Laptop size={14} className="text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">This browser</h3>
      </header>

      <div className="space-y-2.5 rounded-md border border-border bg-card/40 p-3">
        <Row label="Connected to">
          <span className="font-mono text-foreground">
            {hostInfo.data?.hostname ?? hostname}
            <span className="text-muted-foreground/70"> · {hostname}</span>
          </span>
        </Row>
        <Row label="Mode">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium',
              location.kind === 'host'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                location.kind === 'host' ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
            {location.kind === 'host' ? 'On the host machine' : 'Remote client'}
          </span>
        </Row>

        {!isLoopback && (
          <div className="border-t border-border/60 pt-1">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={claimed}
                onChange={toggleClaim}
                className="mt-0.5 accent-primary"
              />
              <div className="flex-1 text-[11.5px]">
                <div className="font-medium text-foreground">Treat this hostname as my host machine</div>
                <div className="text-muted-foreground/85">
                  Surface same-machine actions (Reveal in Finder, Open in editor) for{' '}
                  <span className="font-mono">{hostname}</span>. Use this when accessing the app on the host via
                  Tailscale or a stable LAN DNS name.
                </div>
              </div>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-24 flex-shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className="min-w-0 flex-1 text-[12px]">{children}</span>
    </div>
  );
}
