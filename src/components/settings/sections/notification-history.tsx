'use client';

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NOTIFICATION_HISTORY_CHANNEL_LABELS, NOTIFICATION_HISTORY_STATUS_LABELS, type NotificationHistoryResponse, type NotificationHistoryStatus } from '@/lib/notifications/history';

function displayTime(raw: string) {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Increment refreshKey after channel changes or an explicit test send. */
export function NotificationHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const id = useId();
  const [status, setStatus] = useState<NotificationHistoryStatus | 'all'>('all');
  const [channelId, setChannelId] = useState('all');
  const query = useQuery({
    queryKey: ['notification-delivery-history', refreshKey],
    queryFn: ({ signal }) => api.get<NotificationHistoryResponse>('/notifications/deliveries', { signal, timeoutMs: 10_000 }),
    staleTime: 10_000, gcTime: 0, refetchInterval: 15_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, retry: false,
  });
  const deliveries = query.data?.deliveries ?? [];
  const channels = [...new Map(deliveries.map(item => [item.channel.id, item.channel])).values()];
  // Removing a destination removes its history. Do not retain a vanished filter.
  const selectedChannel = channels.some(channel => channel.id === channelId) ? channelId : 'all';
  const visible = deliveries.filter(item => (status === 'all' || item.status === status) && (selectedChannel === 'all' || item.channel.id === selectedChannel));
  const filterClass = 'rounded-md border border-border bg-background px-2 py-1.5 text-xs';

  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent delivery history</h2>
        <Button type="button" variant="ghost" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {query.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh history
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Latest 100 deliveries across your notification channels. Filters apply to this recent list. Removing a channel also removes its history.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-status`} className="text-xs text-muted-foreground">Status</label>
        <select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value as NotificationHistoryStatus | 'all')} className={filterClass}>
          <option value="all">All statuses</option>
          {Object.entries(NOTIFICATION_HISTORY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={`${id}-channel`} className="text-xs text-muted-foreground">Channel</label>
        <select id={`${id}-channel`} value={selectedChannel} onChange={event => setChannelId(event.target.value)} className={`${filterClass} max-w-56`}>
          <option value="all">All channels</option>
          {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.label}</option>)}
        </select>
      </div>
      {query.isPending && <p role="status" className="text-xs text-muted-foreground">Loading delivery history…</p>}
      {query.isError && <p role="alert" className="text-xs text-destructive">Could not refresh delivery history. Try again shortly.{query.data ? ' Showing the last loaded results.' : ''}</p>}
      {!query.isPending && !query.isError && visible.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">{deliveries.length ? 'No recent deliveries match these filters.' : 'No deliveries yet. Alerts and channel tests will appear here.'}</p>}
      {visible.length > 0 && <ol aria-label="Recent notification deliveries" className="max-h-[32rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {visible.map(item => <li key={item.id} className="space-y-1.5 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-medium">{item.title}</p>
            <Badge variant={item.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0">{NOTIFICATION_HISTORY_STATUS_LABELS[item.status]}</Badge>
          </div>
          <p className="break-words text-xs text-muted-foreground">{item.channel.label} · {NOTIFICATION_HISTORY_CHANNEL_LABELS[item.channel.type]} · {item.eventLabel}</p>
          <p className="text-xs text-muted-foreground">{item.detail}</p>
          <p className="text-[11px] text-muted-foreground">
            Created <time dateTime={item.createdAt}>{displayTime(item.createdAt)}</time> · {item.attempts} {item.attempts === 1 ? 'attempt' : 'attempts'}
            {item.sentAt ? <> · Sent <time dateTime={item.sentAt}>{displayTime(item.sentAt)}</time></> : item.updatedAt !== item.createdAt ? <> · Updated <time dateTime={item.updatedAt}>{displayTime(item.updatedAt)}</time></> : null}
          </p>
        </li>)}
      </ol>}
    </section>
  );
}
