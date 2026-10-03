/** Per-view transport preference. Cache keys and server data are independent. */
export type TransportMode = 'http' | 'websocket';
export const TRANSPORT_STORAGE_KEY = 'ri.client.apiTransport';
const listeners = new Set<() => void>();
const modeListeners = new Set<() => void>();
let watching = false;
let memoryMode: TransportMode | undefined;
export interface TransportStatus {
  state: 'http' | 'connecting' | 'websocket' | 'fallback';
  reason: string | null;
  httpRequests: number;
  websocketRequests: number;
  httpMs: number | null;
  websocketMs: number | null;
}
const initial: TransportStatus = { state: 'http', reason: null, httpRequests: 0, websocketRequests: 0, httpMs: null, websocketMs: null };
let status = initial;
export function getTransportMode(): TransportMode {
  if (typeof window === 'undefined') return 'http';
  if (memoryMode) return memoryMode;
  try { return window.localStorage.getItem(TRANSPORT_STORAGE_KEY) === 'websocket' ? 'websocket' : 'http'; } catch { return 'http'; }
}
export function setTransportMode(mode: TransportMode): void {
  memoryMode = mode;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(TRANSPORT_STORAGE_KEY, mode); } catch { /* session-only when storage is unavailable */ }
  }
  for (const listener of modeListeners) listener();
  for (const listener of listeners) listener();
}
export function subscribeTransport(listener: () => void): () => void {
  listeners.add(listener);
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    window.addEventListener('storage', event => {
      if (event.key === TRANSPORT_STORAGE_KEY || event.key === null) {
        memoryMode = undefined;
        for (const notify of modeListeners) notify();
        for (const notify of listeners) notify();
      }
    });
  }
  return () => { listeners.delete(listener); };
}
export function subscribeTransportMode(listener: () => void): () => void {
  modeListeners.add(listener);
  const unwatch = subscribeTransport(() => {});
  return () => { modeListeners.delete(listener); unwatch(); };
}
export const getTransportStatus = () => status;
export const getServerTransportStatus = () => initial;
export function reportTransportStatus(patch: Partial<TransportStatus>): void {
  if (Object.entries(patch).every(([key, value]) => status[key as keyof TransportStatus] === value)) return;
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}
export function recordTransportRequest(mode: TransportMode, ms: number): void {
  reportTransportStatus(mode === 'http' ? { httpRequests: status.httpRequests + 1, httpMs: ms }
    : { websocketRequests: status.websocketRequests + 1, websocketMs: ms });
}
