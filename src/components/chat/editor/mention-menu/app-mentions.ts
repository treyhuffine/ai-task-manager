import type { AppMentionMenuItem, AppMentionResults, SearchAppMentions } from './types';

/** Items per app in the mixed picker. `@app:` shows every item the app returned. */
export const APP_MENTIONS_MIXED = 5;
/** Wait this long after the last keystroke before asking the apps. */
export const APP_MENTION_DEBOUNCE_MS = 150;

/**
 * Whether to ask connected apps for @ items. Never inside a reference folder
 * or an account list, nor in a picker narrowed to another kind. The mixed
 * picker asks once something is typed, so a bare `@` stays short. `@app:`
 * asks even when empty, since OpenAI's search accepts an empty query.
 */
export function shouldSearchAppMentions(filter: string | null, text: string, browsing: boolean): boolean {
  if (browsing) return false;
  if (filter === 'app') return true;
  return filter === null && text.trim().length > 0;
}

/** Results as picker rows, grouped by app in the order the apps answered. */
export function appMentionItems(results: AppMentionResults | null, narrowed: boolean): AppMentionMenuItem[] {
  if (!Array.isArray(results?.groups)) return [];
  const limit = narrowed ? Infinity : APP_MENTIONS_MIXED;
  return results.groups.flatMap(group => (group.items ?? []).slice(0, limit).map(item => ({
    kind: 'appMention' as const,
    serverId: group.serverId,
    group: group.account ? `${group.app} · ${group.account}` : group.app,
    sourceRef: item.sourceRef,
    title: item.title,
    ...(item.subtitle ? { subtitle: item.subtitle } : {}),
    icons: item.icons,
    appIcons: group.icons,
  })));
}

const abortError = () => new DOMException('The search was replaced', 'AbortError');

/**
 * Wraps the search so typing doesn't send a request per keystroke: each call
 * waits briefly and gives up when a newer query aborts it. Recent answers are
 * reused for a short while, so deleting back to an earlier query is instant.
 */
export function debouncedAppMentionSearch(
  search: (query: string, signal?: AbortSignal) => Promise<AppMentionResults>,
  options: { delayMs?: number; ttlMs?: number; size?: number; now?: () => number } = {},
): SearchAppMentions & { clear(): void } {
  const delayMs = options.delayMs ?? APP_MENTION_DEBOUNCE_MS, ttlMs = options.ttlMs ?? 15_000, size = options.size ?? 20;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; results: AppMentionResults }>();
  const run = async (query: string, signal?: AbortSignal) => {
    const cached = cache.get(query);
    if (cached && now() - cached.at < ttlMs) return cached.results;
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, delayMs);
      const cancel = () => { clearTimeout(timer); reject(abortError()); };
      signal?.addEventListener('abort', cancel, { once: true });
    });
    const results = await search(query, signal);
    cache.delete(query);
    cache.set(query, { at: now(), results });
    while (cache.size > size) cache.delete(cache.keys().next().value!);
    return results;
  };
  return Object.assign(run, { clear: () => cache.clear() });
}
