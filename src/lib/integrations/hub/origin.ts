/**
 * What started a hub call (docs/personal-apps.md "The hub"), for its audit entry and for where its
 * approval shows. An app's call to the hub carries no chat: the app doesn't know Ri's chats. So
 * Ri remembers its own calls into each app while they run, and a hub call from that app during
 * one is attributed to it: a chat, or the person using the app's screen. A job names itself in
 * the call's `_meta` (`app/job`), as the kit's connector client does. Anything else is the app on
 * its own. None of this is access: the grant alone decides what a call may do.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { processState } from '@/lib/process-state';

export interface StartedBy {
  kind: 'chat' | 'person' | 'job' | 'app';
  /** The chat ID, or the job's run. */
  id?: string;
  /** The job's name, or the chat's, for the log. */
  label?: string;
}

/** Who Ri is calling an app for, through the async work of one request. */
const current = () => processState('hub.origin.current', () => new AsyncLocalStorage<StartedBy>());
/** Ri's calls into each app now running, by the app's origin. */
const inFlight = () => processState('hub.origin.in-flight', () => new Map<string, Map<symbol, StartedBy>>());

/** Run Ri's work for a chat or the person, so calls it makes into apps are attributed to them. */
export function withStartedBy<T>(startedBy: StartedBy, work: () => T): T {
  return current().run(startedBy, work);
}

/** An app's address, as one key whatever loopback name it was reached by. */
export function appOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ? 'loopback' : parsed.hostname;
    return `${parsed.protocol}//${host}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
  } catch { return null; }
}

/** Ri calling into an app: while it runs, the app's hub calls belong to whoever Ri is acting for. */
export async function trackAppCall<T>(appUrl: string, work: () => Promise<T>): Promise<T> {
  const startedBy = current().getStore();
  const origin = appOrigin(appUrl);
  if (!startedBy || !origin) return work();
  const key = Symbol('call');
  const calls = inFlight();
  const running = calls.get(origin) ?? new Map<symbol, StartedBy>();
  running.set(key, startedBy);
  calls.set(origin, running);
  try { return await work(); }
  finally {
    running.delete(key);
    if (!running.size) calls.delete(origin);
  }
}

/**
 * What started a hub call from an app at these addresses: the job it names, else the one chat or
 * person Ri is calling the app for right now, else the app on its own. Two different callers at
 * once can't be told apart, so that is the app on its own too.
 */
export function startedByFor(appUrls: readonly (string | null | undefined)[], meta: Record<string, unknown> | undefined): StartedBy {
  const job = typeof meta?.['app/job'] === 'string' ? (meta['app/job'] as string).slice(0, 120) : null;
  if (job) {
    const run = typeof meta?.['app/jobRun'] === 'string' ? (meta['app/jobRun'] as string).slice(0, 120) : undefined;
    return { kind: 'job', label: job, ...(run ? { id: run } : {}) };
  }
  const candidates = new Map<string, StartedBy>();
  for (const url of appUrls) {
    const origin = appOrigin(url);
    for (const startedBy of origin ? inFlight().get(origin)?.values() ?? [] : []) candidates.set(`${startedBy.kind}:${startedBy.id ?? ''}`, startedBy);
  }
  return candidates.size === 1 ? [...candidates.values()][0]! : { kind: 'app' };
}
