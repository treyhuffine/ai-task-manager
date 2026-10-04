'use client';
import { useSyncExternalStore } from 'react';
import { DEFAULT_BROWSER_TRANSPORT, getTransportMode, getTransportStatus, getServerTransportStatus, setTransportMode, subscribeTransport } from '@/lib/trpc/transport-state';

export function ApiTransportSettings() {
  const mode = useSyncExternalStore(subscribeTransport, getTransportMode, () => DEFAULT_BROWSER_TRANSPORT);
  const status = useSyncExternalStore(subscribeTransport, getTransportStatus, getServerTransportStatus);
  return (
    <section className="space-y-2">
      <h3 className="text-[12px] font-medium text-foreground">Connection transport</h3>
      <p className="text-[11px] text-muted-foreground/85">WebSocket is the default for requests and terminal output on this device. Choose HTTP to switch immediately. Your data and caches stay in place.</p>
      <select aria-label="Connection transport" value={mode} onChange={event => setTransportMode(event.target.value === 'websocket' ? 'websocket' : 'http')}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
        <option value="websocket">WebSocket (default)</option>
        <option value="http">HTTP</option>
      </select>
      <p role="status" className="text-[11px] text-muted-foreground">
        {mode === 'http' ? 'Using HTTP.' : status.state === 'websocket' ? 'WebSocket connected.' : status.state === 'connecting' ? 'Connecting to WebSocket.' : status.reason ?? 'Using HTTP until WebSocket connects.'}
      </p>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Transport diagnostics</summary>
        <p>Completed HTTP requests: {status.httpRequests}. Last response: {status.httpMs === null ? 'none' : `${Math.round(status.httpMs)} ms`}.</p>
        <p>Completed WebSocket requests: {status.websocketRequests}. Last response: {status.websocketMs === null ? 'none' : `${Math.round(status.websocketMs)} ms`}.</p>
        <p>Response times include Home work. Compare the same operations on the same connection.</p>
      </details>
    </section>
  );
}
