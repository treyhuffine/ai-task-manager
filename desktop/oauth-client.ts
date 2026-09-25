import type { Session } from 'electron';
import { callbackParams, safeReturnPath, type DesktopOAuthResult } from '../src/lib/connectors/desktop-oauth';

export function parseDeepLink(raw: string): URLSearchParams | null {
  try {
    if (raw.length > 20_000) return null;
    const url = new URL(raw);
    if (url.protocol !== 'ri:' || url.hostname !== 'oauth' || url.pathname !== '/callback' || url.port || url.username || url.password || url.hash) return null;
    return callbackParams(url.searchParams);
  } catch { return null; }
}

export function resultLocation(origin: string, result: DesktopOAuthResult) {
  const url = new URL(safeReturnPath(result.returnTo), origin);
  url.searchParams.set(result.status === 'connected' ? 'connected' : 'error', result.message);
  return url.href;
}

/** The stream is authenticated by the existing Electron session cookie. */
export async function watchOAuthResults(ses: Session, origin: string, signal: AbortSignal, onResult: (result: DesktopOAuthResult) => void) {
  let cursor = 0;
  while (!signal.aborted) {
    try {
      const response = await ses.fetch(`${origin}/api/desktop/oauth/events?after=${cursor}`, { signal });
      if (!response.ok || !response.body) throw new Error('Could not watch connector sign-in');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!event.startsWith('data: ')) continue;
          const result = JSON.parse(event.slice(6)) as DesktopOAuthResult;
          if (!Number.isSafeInteger(result.sequence) || result.sequence <= cursor || !['connected', 'cancelled', 'error'].includes(result.status) || typeof result.returnTo !== 'string' || typeof result.message !== 'string') continue;
          cursor = result.sequence;
          onResult(result);
        }
        if (buffer.length > 64_000) throw new Error('Invalid callback event');
      }
    } catch { if (signal.aborted) return; }
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 1000);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
}
