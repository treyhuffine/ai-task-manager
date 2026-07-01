'use client';

/**
 * Notifications settings (docs/connectors-email-and-notifier-spec.md §2.6/§2.11).
 *
 * Organized as a guided flow rather than a wall of cards:
 *   1. Status     — one line telling you whether you're set up + what to fix.
 *   2. Add        — the two ways to start (browser push, Telegram), up top.
 *   3. Channels   — compact list of where alerts go (test / enable / remove).
 *   4. Routing    — an events × channels matrix to review/edit what fires where.
 *   5. Advanced   — scheduled digests + deep-link base URL, collapsed by default.
 *
 * A `web_push` channel is "all this user's browsers" (one per user, auto-created on
 * first subscribe); per-browser subscription is separate state shown on its row.
 * Telegram channels are one per chat. The remote/tunnel URL is edited in Devices;
 * here it is shown read-only with a jump to that section.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Bell, Send, Globe, Plus, Trash2, Calendar, AlertCircle, Loader2, Info, Link2, ChevronDown,
  CheckCircle2, ShieldCheck, Monitor,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { EVENT_CATALOG } from '@/lib/notifications/events';
import {
  webPushSupported,
  isWebPushSubscribed,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '@/lib/notifications/web-push-client';
import type { NotificationChannelRecord } from '@/db/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { setSettingsSection } from '@/components/settings/settings-store';
import { SettingsSkeleton } from '@/components/settings/settings-skeleton';
import { ConnectorLogo } from '@/components/connectors/connector-logo';

interface Connection {
  id: string;
  providerId: string;
  accountId: string;
  email?: string | null;
  label?: string | null;
}
interface Digest {
  id: string;
  name: string;
  enabled: boolean;
  deliverResultTo: string[];
}

const MATRIX = EVENT_CATALOG.filter((e) => e.routing === 'matrix');

/** Prefer the API error body's reason ("API 400 …" hides it) so failures are actually readable. */
function errMsg(e: unknown): string {
  const body = (e as { body?: { error?: string } }).body;
  if (body?.error) return body.error;
  return e instanceof Error ? e.message : String(e);
}

export function NotificationsSection() {
  const [channels, setChannels] = useState<NotificationChannelRecord[]>([]);
  const [telegramConns, setTelegramConns] = useState<Connection[]>([]);
  const [digests, setDigests] = useState<Digest[]>([]);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Telegram add flow
  const [addTgOpen, setAddTgOpen] = useState(false);
  const [newConnId, setNewConnId] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [discoveredChats, setDiscoveredChats] = useState<{ chatId: string; name: string }[]>([]);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState('');
  const [linking, setLinking] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const [testResults, setTestResults] = useState<Record<string, { status: string; error?: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const [baseUrls, setBaseUrls] = useState<{ tunnel: string | null; lan: string | null; local: string }>({
    tunnel: null,
    lan: null,
    local: '',
  });

  const refresh = useCallback(async () => {
    const [ch, cn, dg, bu] = await Promise.all([
      api.get<{ channels: NotificationChannelRecord[] }>('/notifications/channels'),
      api.get<{ connections: Connection[] }>('/connectors/connections'),
      api.get<{ digests: Digest[] }>('/notifications/digests'),
      api.get<{ tunnel: string | null; lan: string | null; local: string }>('/settings/base-url'),
    ]);
    setChannels(ch.channels);
    setTelegramConns(cn.connections.filter((c) => c.providerId === 'telegram'));
    setDigests(dg.digests);
    setBaseUrls(bu);
    if (webPushSupported()) setPushSubscribed(await isWebPushSubscribed());
  }, []);

  useEffect(() => {
    refresh()
      .catch((e) => setError(errMsg(e)))
      .finally(() => setIsLoading(false));
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // --- Channels ------------------------------------------------------------

  const toggleEvent = (channel: NotificationChannelRecord, type: string) =>
    run(async () => {
      const current = channel.events ?? [];
      const events = current.includes(type) ? current.filter((e) => e !== type) : [...current, type];
      await api.patch(`/notifications/channels/${channel.id}`, { events });
    });

  const toggleEnabled = (channel: NotificationChannelRecord) =>
    run(() => api.patch(`/notifications/channels/${channel.id}`, { enabled: !channel.enabled }).then(() => {}));

  const removeChannel = (id: string) => run(() => api.delete(`/notifications/channels/${id}`).then(() => {}));

  const renameChannel = (id: string, label: string) =>
    run(() => api.patch(`/notifications/channels/${id}`, { label }).then(() => {}));

  const sendTest = async (id: string) => {
    setTesting(id);
    setError(null);
    try {
      const r = await api.post<{ status: string; error?: string }>(`/notifications/channels/${id}/test`, {});
      setTestResults((p) => ({ ...p, [id]: r }));
    } catch (e) {
      setTestResults((p) => ({ ...p, [id]: { status: 'error', error: errMsg(e) } }));
    } finally {
      setTesting(null);
    }
  };

  // --- Web push ------------------------------------------------------------

  const enablePush = () => run(() => subscribeToWebPush());
  const disablePush = () => run(() => unsubscribeFromWebPush());

  // --- Telegram add --------------------------------------------------------

  const addTelegram = () =>
    run(async () => {
      await api.post('/notifications/channels', {
        kind: 'connector',
        providerId: 'telegram',
        connectionId: newConnId,
        ...(newLabel.trim() ? { label: newLabel.trim() } : {}),
        config: { chatId: newChatId.trim() },
      });
      setNewConnId('');
      setNewChatId('');
      setNewLabel('');
      setDiscoveredChats([]);
      setAddTgOpen(false);
    });

  const discoverChats = () =>
    run(async () => {
      if (!newConnId) return;
      const r = await api.get<{ chats: { chatId: string; name: string }[] }>(
        `/notifications/telegram/chats?connectionId=${encodeURIComponent(newConnId)}`,
      );
      setDiscoveredChats(r.chats);
      if (r.chats.length === 1) {
        setNewChatId(r.chats[0]!.chatId);
        if (!newLabel.trim()) setNewLabel(r.chats[0]!.name);
      }
    });

  // When a bot connection is selected, fetch its username + mint a one-time link token so the
  // tap-to-link anchor is ready for a real-gesture click (avoids popup blocking).
  useEffect(() => {
    setBotUsername(null);
    if (!newConnId) return;
    setLinkToken(crypto.randomUUID().replace(/-/g, '').slice(0, 24));
    let cancelled = false;
    api
      .get<{ username?: string }>(`/notifications/telegram/bot?connectionId=${encodeURIComponent(newConnId)}`)
      .then((r) => {
        if (!cancelled) setBotUsername(r.username ?? null);
      })
      .catch(() => {
        if (!cancelled) setBotUsername(null);
      });
    return () => {
      cancelled = true;
    };
  }, [newConnId]);

  // After the user taps the t.me link + presses Start, poll the claim endpoint until the bot
  // receives the `/start <token>` and the channel auto-links.
  const startLinking = useCallback(() => {
    if (!newConnId || !linkToken || linking) return;
    setLinking(true);
    setError(null);
    void (async () => {
      try {
        for (let i = 0; i < 25; i += 1) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const res = await api.post<{ channel?: NotificationChannelRecord; found?: boolean }>(
              '/notifications/telegram/claim',
              { connectionId: newConnId, token: linkToken },
            );
            if (res.channel) {
              await refresh();
              setNewConnId('');
              setAddTgOpen(false);
              return;
            }
          } catch {
            // Transient (e.g. a Telegram getUpdates conflict) — keep polling, don't abort the flow.
          }
        }
        setError('Timed out waiting for Telegram. Tap “Start” in the chat, then try again.');
      } finally {
        setLinking(false);
      }
    })();
  }, [newConnId, linkToken, linking, refresh]);

  // --- Advanced: digests ---------------------------------------------------

  const setDigestChannels = (digestId: string, channelId: string, on: boolean) =>
    run(async () => {
      const digest = digests.find((d) => d.id === digestId);
      if (!digest) return;
      const deliverResultTo = on
        ? [...digest.deliverResultTo, channelId]
        : digest.deliverResultTo.filter((c) => c !== channelId);
      await api.patch(`/notifications/digests/${digestId}`, { deliverResultTo });
    });

  // --- Display helpers -----------------------------------------------------

  const channelType = (c: NotificationChannelRecord): string => {
    if (c.kind === 'web_push') return 'Web push';
    if (c.kind === 'connector' && c.providerId) return c.providerId.charAt(0).toUpperCase() + c.providerId.slice(1);
    return c.kind;
  };
  const channelDetail = (c: NotificationChannelRecord): string | null => {
    if (c.label) return c.label;
    if (c.kind === 'connector' && c.providerId === 'telegram') {
      return String((c.config as { chatId?: unknown }).chatId ?? '') || null;
    }
    return null;
  };
  const channelLabel = (c: NotificationChannelRecord): string => {
    const detail = channelDetail(c);
    return detail ? `${channelType(c)} · ${detail}` : channelType(c);
  };
  const channelShort = (c: NotificationChannelRecord): string => channelDetail(c) ?? channelType(c);
  // Real brand logo for connector channels (Telegram, …); a Globe tile for web push.
  const channelVisual = (c: NotificationChannelRecord, size = 36) => {
    if (c.kind === 'connector' && c.providerId) {
      return <ConnectorLogo providerId={c.providerId} name={channelType(c)} size={size} />;
    }
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground ring-1 ring-inset ring-border/50"
        style={{ width: size, height: size }}
      >
        <Globe size={Math.round(size * 0.5)} />
      </span>
    );
  };

  // --- Derived status ------------------------------------------------------

  const enabledChannels = channels.filter((c) => c.enabled);
  const routedEventCount = MATRIX.filter((e) =>
    channels.some((c) => c.enabled && (c.events ?? []).includes(e.type)),
  ).length;
  const hasExternalChannel = channels.some((c) => c.kind === 'connector');
  const externalLinksUnreachable = hasExternalChannel && !baseUrls.tunnel;

  if (isLoading) {
    return <SettingsSkeleton rows={4} />;
  }

  return (
    <div className="space-y-6">
      {busy && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Saving…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h5 className="font-semibold">Action Failed</h5>
            <p className="opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* 1. Status */}
      {channels.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
          <div className="rounded-lg bg-muted/70 p-2 text-muted-foreground">
            <Bell size={16} />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-foreground">No notifications set up yet</h3>
            <p className="text-[12px] text-muted-foreground">
              Add a channel below to start getting alerts when an agent needs you or finishes a run.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-xl border p-3 text-xs',
              enabledChannels.length > 0
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
            )}
          >
            <CheckCircle2 size={16} className="shrink-0" />
            <span className="font-medium">
              {enabledChannels.length > 0 ? (
                <>
                  Active · {enabledChannels.length} {enabledChannels.length === 1 ? 'channel' : 'channels'} · routing{' '}
                  {routedEventCount} of {MATRIX.length} event types
                </>
              ) : (
                <>All channels are turned off. You won&apos;t receive anything until you enable one.</>
              )}
            </span>
          </div>
          {externalLinksUnreachable && (
            <button
              type="button"
              onClick={() => setSettingsSection('devices')}
              className="flex w-full items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-left text-[11px] leading-normal text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
            >
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                Telegram links use your LAN address and won&apos;t open off your network.{' '}
                <span className="font-semibold underline">Set a public URL in Devices.</span>
              </span>
            </button>
          )}
        </div>
      )}

      {/* 2. Add a channel */}
      <div className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Add a channel</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {/* Web push */}
          {!webPushSupported() ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
              <Globe size={15} className="shrink-0" /> Browser push isn&apos;t supported in this browser.
            </div>
          ) : pushSubscribed ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={15} className="shrink-0" /> Browser push on for this device
            </div>
          ) : (
            <button
              type="button"
              onClick={enablePush}
              disabled={busy}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card/30 p-3 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              <div className="rounded-lg bg-muted/60 p-2 text-muted-foreground">
                <Globe size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">Enable browser push</div>
                <div className="text-[11px] text-muted-foreground">Notifications on this device</div>
              </div>
            </button>
          )}

          {/* Telegram */}
          <button
            type="button"
            onClick={() => setAddTgOpen((v) => !v)}
            aria-expanded={addTgOpen}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border border-border bg-card/30 p-3 text-left transition-colors hover:bg-muted/40',
              addTgOpen && 'bg-muted/40',
            )}
          >
            <ConnectorLogo providerId="telegram" name="Telegram" size={36} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground">Connect Telegram</div>
              <div className="text-[11px] text-muted-foreground">Alerts in a Telegram chat</div>
            </div>
            <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', addTgOpen && 'rotate-180')} />
          </button>
        </div>

        {/* Telegram add panel */}
        {addTgOpen && (
          <div className="rounded-xl border border-border bg-card/20 p-4">
            {telegramConns.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs leading-normal text-muted-foreground">
                  First connect a Telegram bot in Connectors, then come back here to pick a chat.
                </p>
                <Button
                  variant="outline"
                  className="w-full justify-center text-xs font-semibold"
                  onClick={() => setSettingsSection('connectors')}
                >
                  Go to Connectors
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Bot connection
                  </label>
                  <Select value={newConnId} onValueChange={setNewConnId}>
                    <SelectTrigger className="h-9 w-full rounded-4xl border-input bg-input/30 text-xs">
                      <SelectValue placeholder="Select a connected bot..." />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl">
                      {telegramConns.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.label ?? c.accountId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Primary: tap-to-link */}
                {newConnId && (
                  <div className="space-y-2">
                    {botUsername ? (
                      <>
                        <a
                          href={`https://t.me/${botUsername}?start=${linkToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={startLinking}
                          className={cn(
                            'flex w-full items-center justify-center gap-1.5 rounded-4xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90',
                            linking ? 'pointer-events-none opacity-70' : '',
                          )}
                        >
                          {linking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          {linking ? 'Waiting for Telegram…' : 'Link with Telegram'}
                        </a>
                        <p className="text-[10px] leading-normal text-muted-foreground">
                          Opens a chat with <span className="font-medium">@{botUsername}</span>. Tap{' '}
                          <span className="font-medium">Start</span> and this channel links itself. No chat id needed.
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">Loading bot…</p>
                    )}
                  </div>
                )}

                {/* Fallback: manual */}
                {newConnId && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowManual((v) => !v)}
                      className="text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      {showManual ? '− Hide manual entry' : '+ Enter a chat id manually'}
                    </button>

                    {showManual && (
                      <div className="space-y-4 border-t border-border/40 pt-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Chat ID
                            </label>
                            <button
                              type="button"
                              onClick={discoverChats}
                              disabled={busy || !newConnId}
                              className="text-[10px] font-semibold text-primary hover:underline disabled:opacity-40"
                            >
                              Discover chats
                            </button>
                          </div>
                          <Input
                            value={newChatId}
                            onChange={(e) => setNewChatId(e.target.value)}
                            placeholder="e.g. -100123456789 or 987654321"
                            className="rounded-4xl font-mono text-xs"
                          />
                          {discoveredChats.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {discoveredChats.map((ch) => (
                                <button
                                  type="button"
                                  key={ch.chatId}
                                  onClick={() => {
                                    setNewChatId(ch.chatId);
                                    if (!newLabel.trim()) setNewLabel(ch.name);
                                  }}
                                  className={cn(
                                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                                    newChatId === ch.chatId
                                      ? 'border-primary bg-primary/10 text-foreground'
                                      : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
                                  )}
                                >
                                  {ch.name} <span className="font-mono opacity-60">({ch.chatId})</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Label <span className="opacity-60">(optional)</span>
                          </label>
                          <Input
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="e.g. My phone"
                            className="rounded-4xl text-xs"
                          />
                        </div>

                        <Button
                          className="w-full justify-center text-xs font-semibold"
                          onClick={addTelegram}
                          disabled={busy || !newConnId || !newChatId.trim()}
                        >
                          <Plus size={14} /> Add Telegram channel
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Channels */}
      {channels.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Channels</h2>
            <Badge variant="secondary" className="rounded-full text-[10px]">
              {channels.length} total
            </Badge>
          </div>
          <div className="space-y-2">
            {channels.map((c) => {
              const tr = testResults[c.id];
              const isWebPush = c.kind === 'web_push';
              return (
                <div key={c.id} className="rounded-xl border border-border bg-card/30 p-3">
                  <div className="flex items-center gap-3">
                    <div className={cn('shrink-0', !c.enabled && 'opacity-50')}>{channelVisual(c, 36)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{channelLabel(c)}</span>
                        {!c.enabled && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Off
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {isWebPush
                          ? 'All your subscribed browsers'
                          : `Chat ${String((c.config as { chatId?: unknown }).chatId ?? '-')}`}
                        {(c.events ?? []).length > 0 && ` · ${(c.events ?? []).length} events`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => sendTest(c.id)}
                        disabled={busy || testing === c.id}
                        className="text-xs"
                      >
                        {testing === c.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                        Test
                      </Button>
                      <Button
                        variant={c.enabled ? 'outline' : 'secondary'}
                        size="xs"
                        onClick={() => toggleEnabled(c)}
                        disabled={busy}
                        className={cn(
                          'text-xs',
                          c.enabled &&
                            'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 dark:border-emerald-400/20 dark:text-emerald-400',
                        )}
                      >
                        {c.enabled ? 'On' : 'Off'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon-xs"
                        onClick={() => removeChannel(c.id)}
                        disabled={busy}
                        title="Remove channel"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>

                  {/* Per-browser control for the web_push channel */}
                  {isWebPush && webPushSupported() && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Monitor size={12} />
                        This browser: {pushSubscribed ? 'subscribed' : 'not subscribed'}
                      </span>
                      {pushSubscribed ? (
                        <Button variant="ghost" size="xs" onClick={disablePush} disabled={busy} className="text-xs">
                          Turn off here
                        </Button>
                      ) : (
                        <Button variant="ghost" size="xs" onClick={enablePush} disabled={busy} className="text-xs">
                          Enable here
                        </Button>
                      )}
                    </div>
                  )}

                  {tr && (
                    <div
                      className={cn(
                        'mt-2 text-[11px] font-medium',
                        tr.status === 'sent' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                      )}
                    >
                      {tr.status === 'sent'
                        ? '✓ Test notification delivered'
                        : `✗ Test ${tr.status}${tr.error ? `: ${tr.error}` : ''}`}
                    </div>
                  )}

                  {/* Inline rename */}
                  <div className="mt-2.5 flex items-center gap-2 border-t border-border/40 pt-2.5">
                    <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Name
                    </span>
                    <Input
                      defaultValue={c.label ?? ''}
                      placeholder={isWebPush ? 'e.g. My browsers' : 'e.g. My phone'}
                      disabled={busy}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (c.label ?? '')) renameChannel(c.id, v);
                      }}
                      className="h-7 max-w-[220px] rounded-lg text-xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Routing matrix */}
      {channels.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Routing</h2>
            <p className="text-[11px] text-muted-foreground">Pick which events each channel delivers.</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card/20">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th className="p-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Event</th>
                  {channels.map((c) => (
                    <th key={c.id} title={channelLabel(c)} className={cn('p-2 align-bottom', !c.enabled && 'opacity-50')}>
                      <div className="flex flex-col items-center gap-1">
                        {channelVisual(c, 18)}
                        <span className="max-w-[68px] truncate text-[10px] font-medium text-foreground">
                          {channelShort(c)}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((e) => (
                  <tr key={e.type} className="border-t border-border/40">
                    <td className="max-w-[230px] p-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">{e.label}</span>
                        {e.type === 'deck.surfaced' && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Soon
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{e.description}</div>
                    </td>
                    {channels.map((c) => (
                      <td key={c.id} className={cn('p-2 text-center align-middle', !c.enabled && 'opacity-50')}>
                        <input
                          type="checkbox"
                          checked={(c.events ?? []).includes(e.type)}
                          disabled={busy}
                          onChange={() => toggleEvent(c, e.type)}
                          aria-label={`${e.label} to ${channelLabel(c)}`}
                          className="size-4 cursor-pointer rounded border-border accent-primary"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {channels.some((c) => !c.enabled) && (
            <p className="text-[10px] text-muted-foreground">
              Dimmed channels are turned off and won&apos;t deliver until re-enabled.
            </p>
          )}
        </div>
      )}

      {/* 5. Advanced */}
      <CollapsibleSection title="Scheduled digests" icon={<Calendar size={15} className="text-muted-foreground" />}>
        <p className="mb-3 text-[11px] leading-normal text-muted-foreground">
          Route outcomes from automated agent triggers directly to your channels.
        </p>
        {digests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            No scheduled digests yet.
          </div>
        ) : (
          <div className="space-y-3">
            {digests.map((d) => (
              <div key={d.id} className="space-y-3 rounded-xl border border-border bg-background/30 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">{d.name}</span>
                  <Badge variant={d.enabled ? 'default' : 'secondary'} className="rounded-full text-[10px]">
                    {d.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </div>
                <div className="space-y-2 border-t border-border/30 pt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Deliver to</div>
                  {channels.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">Add a channel to route reports.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {channels.map((c) => {
                        const isChecked = d.deliverResultTo.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-lg border border-border/40 bg-muted/20 p-2 text-xs transition-all hover:bg-muted/45',
                              isChecked ? 'border-primary/20 bg-primary/[0.01]' : '',
                            )}
                          >
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={isChecked}
                              onChange={(e) => setDigestChannels(d.id, c.id, e.target.checked)}
                              className="size-3.5 cursor-pointer rounded border-border accent-primary"
                            />
                            <span className="truncate font-medium text-foreground/90">{channelLabel(c)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Delivery links"
        icon={<Link2 size={15} className="text-muted-foreground" />}
        defaultOpen={externalLinksUnreachable}
      >
        <p className="mb-3 text-[11px] leading-normal text-muted-foreground">
          The base URL deep links use. External channels (Telegram) need a publicly reachable URL. Set your tunnel
          (e.g. beamd) in Devices so links open on your phone.
        </p>
        <div className="space-y-3">
          <div className="space-y-1 rounded-xl border border-border/50 bg-muted/40 p-3 text-xs">
            <span className="text-muted-foreground">External links currently use </span>
            {baseUrls.tunnel ? (
              <span className="break-all font-mono text-emerald-600 dark:text-emerald-400">{baseUrls.tunnel}</span>
            ) : baseUrls.lan ? (
              <span className="break-all font-mono text-amber-600 dark:text-amber-400">{baseUrls.lan}</span>
            ) : (
              <span className="break-all font-mono">{baseUrls.local} (omitted in external messages)</span>
            )}
            {!baseUrls.tunnel && (
              <p className="text-[10px] leading-normal text-amber-600 dark:text-amber-400">
                No remote URL set. Links use your LAN address, which won&apos;t open off your network.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            className="w-full justify-center text-xs font-semibold"
            onClick={() => setSettingsSection('devices')}
          >
            <Link2 size={13} />
            {baseUrls.tunnel ? 'Change remote URL in Devices' : 'Set remote URL in Devices'}
          </Button>
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** A titled section that collapses its body behind a chevron. */
function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </span>
        <ChevronDown size={16} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border/50 px-4 py-4">{children}</div>}
    </div>
  );
}
