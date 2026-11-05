// Logic with no browser in it, so it can be tested on its own.

export const MAX_PAGE_CHARS = 200_000;
export const QUEUED_PAGE_CHARS = 50_000;
export const BATCH_SIZE = 100;
export const SAVE_ACTION = 'save_bookmarks';
export const CHECK_ACTION = 'describe_connection';

/** The connection code from the app's Connect screen, or null when it is not one. */
export function parseConnectionCode(raw) {
  const text = String(raw ?? '').trim();
  if (!text.startsWith('ri-bookmarks:')) return null;
  try {
    const body = text.slice('ri-bookmarks:'.length).replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (char) => char.charCodeAt(0))));
    const home = new URL(value.home);
    if (value.v !== 1 || (home.protocol !== 'https:' && home.protocol !== 'http:') || typeof value.key !== 'string' || !value.key) return null;
    return { home: home.origin, app: String(value.app ?? home.origin), key: value.key };
  } catch {
    return null;
  }
}

/** The one site this extension asks to reach. */
export const originPattern = (home) => `${new URL(home).origin}/*`;
export const actionUrl = (home, action) => `${new URL(home).origin}/api/local-apps/client/${action}`;
export const saveable = (url) => /^https?:\/\//i.test(String(url ?? ''));

/** Folder names browsers make for you, which say nothing about the links inside. */
const ROOT_FOLDERS = new Set([
  '', 'bookmarks', 'bookmarks bar', 'bookmarks toolbar', 'bookmarks menu', 'favorites', 'favorites bar', 'favourites', 'favourites bar',
  'other bookmarks', 'other favorites', 'mobile bookmarks', 'synced bookmarks', 'imported', 'unsorted', 'menu', 'toolbar', 'unfiled',
]);
export const tagsFromFolders = (folders) => folders.filter((name) => !ROOT_FOLDERS.has(String(name).trim().toLowerCase())).map((name) => String(name).trim()).slice(0, 20);

/** Every web link in a bookmarks tree, with its folders as tags. */
export function flattenTree(nodes, folders = []) {
  const links = [];
  for (const node of nodes) {
    if (node.url) {
      if (saveable(node.url)) links.push({ url: node.url, title: node.title || null, savedAt: node.dateAdded ?? null, tags: tagsFromFolders(folders) });
    } else if (node.children) {
      links.push(...flattenTree(node.children, [...folders, node.title ?? '']));
    }
  }
  return links;
}

export function batches(items, size = BATCH_SIZE) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

export const clipText = (text, max = MAX_PAGE_CHARS) => (text && text.length > max ? text.slice(0, max) : text || null);

/** What a saved item may keep while it waits in the browser's small storage. */
export const forQueue = (item) => (item.pageText ? { ...item, pageText: clipText(item.pageText, QUEUED_PAGE_CHARS) } : item);

/** Split tags typed in the popup. */
export const parseTags = (text) => String(text ?? '').split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);

/**
 * One call to the Home. `outcome` says what to do next: `ok`, `retry` (the Home
 * can't be reached, or is busy), `rejected` (this request will never work, so it
 * must not block the queue) or `disconnected` (the key no longer works).
 */
export async function callHome(fetcher, connection, action, input) {
  let response;
  try {
    response = await fetcher(actionUrl(connection.home, action), {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { outcome: 'retry', message: 'Could not reach your Ri' };
  }
  const body = await response.json().catch(() => null);
  if (response.ok) return { outcome: 'ok', body };
  if (response.status === 401 || response.status === 403) return { outcome: 'disconnected', message: body?.message ?? body?.error ?? 'Your Ri no longer accepts this connection' };
  if (response.status === 400 || response.status === 413) return { outcome: 'rejected', message: body?.error ?? 'Your Ri refused this link' };
  return { outcome: 'retry', message: body?.error ?? `Your Ri answered ${response.status}` };
}
