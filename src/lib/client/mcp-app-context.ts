import { safeMcpIcon, type McpIcon } from '@/lib/integrations/mcp-icons';

/**
 * What connected app views attach to the next message (OpenAI's
 * `ui/update-model-context`, docs/connected-mcp-apps.md "Model context").
 *
 * A view registers per chat. A global screen has no chat of its own, so it
 * registers with no chat, and its context goes with whichever chat its person
 * sends in next: in practice the main chat beside it. Each chat attaches its
 * most recently updated view, plus the most recently updated global screen.
 *
 * The composer shows what each app attached as one group per app, and
 * removing a group drops that app's context as a whole.
 */
type Reference = { viewId: string; revision: number };
type Scope = string | null;
type Flush = () => Promise<Reference | undefined>;

/** One content block an app attached, as `ui/update-model-context` sent it. */
export type ContextBlock = { type: string; [key: string]: unknown };
/** The parts of an attached block the composer shows. */
export type VisibleContextItem =
  | { kind: 'text'; title?: string; text: string; thumbnail?: McpIcon }
  | { kind: 'image'; title?: string; src: string }
  | { kind: 'link'; title: string; uri: string }
  | { kind: 'resource'; title: string; uri: string; text?: string };
export interface ContextGroup {
  viewId: string;
  app: string;
  items: VisibleContextItem[];
  /** Drops the whole group: the app's context, on the home and in the view. */
  remove: () => Promise<void>;
}
interface Entry {
  flush: Flush;
  app?: string;
  content?: ContextBlock[] | null;
  clear?: () => Promise<void>;
}

const GLOBAL = '\u0000global';
const key = (scope: Scope) => scope ?? GLOBAL;
const contexts = new Map<string, Map<string, Entry>>();
const selected = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => { version++; for (const listener of listeners) listener(); };

export function selectConnectedContext(chatId: Scope, viewId: string) {
  if (selected.get(key(chatId)) === viewId) return;
  selected.set(key(chatId), viewId);
  changed();
}

/**
 * `flush` waits for the view's pending context update and returns the
 * acknowledged revision, or nothing when the view has no context to attach.
 * `info` lets the composer show and remove what the view attached.
 */
export function registerConnectedContext(chatId: Scope, viewId: string, flush: Flush, info?: { app: string; clear: () => Promise<void>; content?: ContextBlock[] | null }) {
  const scope = key(chatId);
  const entries = contexts.get(scope) ?? new Map<string, Entry>();
  contexts.set(scope, entries);
  const entry: Entry = { flush, ...(info ? { app: info.app, clear: info.clear, content: info.content ?? null } : {}) };
  entries.set(viewId, entry);
  changed();
  return () => {
    if (entries.get(viewId) === entry) entries.delete(viewId);
    if (!entries.size) { contexts.delete(scope); selected.delete(scope); }
    changed();
  };
}

/** The content a view's latest acknowledged update attached, or null once cleared. */
export function setConnectedContextContent(chatId: Scope, viewId: string, content: ContextBlock[] | null) {
  const entry = contexts.get(key(chatId))?.get(viewId);
  if (!entry) return;
  entry.content = content;
  changed();
}

export async function flushConnectedContext(chatId: string) {
  const references: Reference[] = [];
  for (const scope of [chatId, null]) {
    const viewId = selected.get(key(scope));
    const flush = viewId ? contexts.get(key(scope))?.get(viewId)?.flush : undefined;
    const reference = await flush?.();
    if (reference && !references.some(item => item.viewId === reference.viewId)) references.push(reference);
  }
  return references;
}

/**
 * Whether a block is shown to the person. Blocks for the assistant alone
 * (`annotations.audience` of exactly `["assistant"]`, OpenAI's "Background
 * Context") are sent to the model and never shown.
 */
export function visibleToPerson(block: ContextBlock) {
  const audience = (block.annotations as { audience?: unknown } | undefined)?.audience;
  return !(Array.isArray(audience) && audience.length > 0 && audience.every(role => role === 'assistant'));
}

const title = (block: ContextBlock) => {
  const value = (block._meta as Record<string, unknown> | undefined)?.['openai/title'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
};
const str = (value: unknown) => typeof value === 'string' ? value : undefined;

/** The composer's view of attached blocks: visible ones only, with titles, thumbnails and image sources it may display. */
export function visibleContextItems(content: readonly ContextBlock[] | null | undefined): VisibleContextItem[] {
  return (content ?? []).filter(visibleToPerson).flatMap((block): VisibleContextItem[] => {
    if (block.type === 'text' && typeof block.text === 'string') {
      const thumbnail = safeMcpIcon((block._meta as Record<string, unknown> | undefined)?.['openai/thumbnail']);
      return [{ kind: 'text', ...(title(block) ? { title: title(block) } : {}), text: block.text, ...(thumbnail ? { thumbnail } : {}) }];
    }
    if (block.type === 'image' && typeof block.data === 'string' && /^image\/[a-z0-9.+-]+$/i.test(str(block.mimeType) ?? '')) {
      return [{ kind: 'image', ...(title(block) ? { title: title(block) } : {}), src: `data:${block.mimeType};base64,${block.data}` }];
    }
    if (block.type === 'resource_link' && typeof block.uri === 'string') {
      return [{ kind: 'link', title: str(block.title) ?? str(block.name) ?? block.uri, uri: block.uri }];
    }
    if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
      const resource = block.resource as Record<string, unknown>;
      if (typeof resource.uri !== 'string') return [];
      return [{ kind: 'resource', title: title(block) ?? str(resource.title) ?? str(resource.name) ?? resource.uri, uri: resource.uri, ...(typeof resource.text === 'string' ? { text: resource.text } : {}) }];
    }
    return [];
  });
}

/**
 * The groups a chat's composer shows: its selected view's, then the selected
 * global screen's, each only while it has something visible.
 */
export function connectedContextGroups(chatId: string | null): ContextGroup[] {
  const groups: ContextGroup[] = [];
  for (const scope of chatId ? [chatId, null] : [null]) {
    const viewId = selected.get(key(scope));
    const entry = viewId ? contexts.get(key(scope))?.get(viewId) : undefined;
    if (!viewId || !entry?.app || !entry.clear || groups.some(group => group.viewId === viewId)) continue;
    const items = visibleContextItems(entry.content);
    if (!items.length) continue;
    const clear = entry.clear;
    groups.push({ viewId, app: entry.app, items, remove: clear });
  }
  return groups;
}

/** For `useSyncExternalStore`: a change to any view's context or selection. */
export function subscribeConnectedContext(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function connectedContextVersion() {
  return version;
}
