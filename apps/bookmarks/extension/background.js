// Copies normal bookmarks to Ri, saves the tab when asked, and keeps anything unsent until the Home answers.
import { callHome, clipText, firstBatch, fitItem, forQueue, SAVE_ACTION, saveable, sendItems, tagsFromFolders } from './lib.js';

const MAX_QUEUE = 5000;
let chain = Promise.resolve();
/** Storage writes read first, so they run one at a time. */
const serial = (work) => (chain = chain.then(work, work));

const stored = (keys) => chrome.storage.local.get(keys);

async function folderNames(parentId) {
  const names = [];
  for (let id = parentId; id; ) {
    const [node] = await chrome.bookmarks.get(id).catch(() => []);
    if (!node) break;
    names.unshift(node.title ?? '');
    id = node.parentId;
  }
  return names;
}

function enqueue(items) {
  const fitted = items.map(fitItem).filter(Boolean).map((item) => ({ ...forQueue(item), queueId: crypto.randomUUID() }));
  return serial(async () => {
    const { queue = [] } = await stored('queue');
    await chrome.storage.local.set({ queue: [...queue, ...fitted].slice(-MAX_QUEUE) });
  });
}

async function showState(state) {
  await chrome.action.setBadgeBackgroundColor({ color: '#a8443b' });
  await chrome.action.setBadgeText({ text: state === 'disconnected' ? '!' : '' });
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const { connection, queue = [] } = await stored(['connection', 'queue']);
      if (!connection || !queue.length) return;
      const via = queue[0].via;
      const end = queue.findIndex((item) => item.via !== via);
      const strip = ({ via: _via, queueId: _queueId, ...item }) => item;
      const batch = firstBatch((end < 0 ? queue : queue.slice(0, end)));
      const result = await sendItems(fetch, connection, via, batch.map(strip));
      const finished = new Set(batch.slice(0, result.done).map((item) => item.queueId));
      if (finished.size) {
        await serial(async () => {
          const { queue: current = [] } = await stored('queue');
          await chrome.storage.local.set({ queue: current.filter((item) => !finished.has(item.queueId)) });
        });
      }
      if (result.outcome === 'retry') return;
      if (result.outcome === 'disconnected') {
        await chrome.storage.local.set({ lastError: result.message, disconnected: true });
        await showState('disconnected');
        return;
      }
      await chrome.storage.local.set({ lastError: result.dropped ? result.message : null, disconnected: false });
      await showState('ok');
    }
  } finally {
    flushing = false;
  }
}

/** Runs inside the page, so it sees what you see, including behind a login. */
function readPage() {
  const article = [...document.querySelectorAll('article, main')].map((node) => node.innerText ?? '').sort((a, b) => b.length - a.length)[0] ?? '';
  const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content ?? null;
  return { text: article.length >= 280 ? article : document.body?.innerText ?? '', description, selection: String(getSelection()) };
}

async function pageContent(tabId) {
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
    return injected?.result ?? null;
  } catch {
    // The browser's own pages, the store and file viewers refuse scripts. The link still saves.
    return null;
  }
}

/** Saves the tab here, not in the popup, because clicking back on the page closes the popup and would cancel it. */
async function saveTab(tab) {
  const { connection } = await stored('connection');
  const content = await pageContent(tab.id);
  const item = fitItem({ url: tab.url, title: tab.title || null, excerpt: content?.description || null, pageText: clipText(content?.text?.trim()) });
  if (!item) return { outcome: 'rejected', message: 'This link is too long to save.' };
  const result = await callHome(fetch, connection, SAVE_ACTION, { via: 'extension', items: [item] });
  if (result.outcome === 'retry') await enqueue([{ via: 'extension', ...item }]);
  return { outcome: result.outcome, message: result.message ?? null, invalid: !!result.body?.invalid, hasText: !!content?.text?.trim(), selection: content?.selection?.trim().slice(0, 4000) ?? '' };
}

chrome.bookmarks.onCreated.addListener(async (_id, node) => {
  if (!saveable(node.url)) return;
  const { connection, mirror = true } = await stored(['connection', 'mirror']);
  if (!connection || !mirror) return;
  await enqueue([{ via: 'bookmark', url: node.url, title: node.title || null, savedAt: node.dateAdded ?? null, tags: tagsFromFolders(await folderNames(node.parentId)) }]);
  await flush();
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === 'save-tab') {
    saveTab(message.tab).then(reply, () => reply({ outcome: 'rejected', message: 'This page could not be saved.' }));
    return true;
  }
  if (message?.type === 'queue') {
    enqueue(message.items).then(flush).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  if (message?.type === 'flush') {
    flush().then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  }
  return false;
});

// The worker restarts often, and creating an alarm again would push it back every time.
chrome.alarms.get('flush').then((alarm) => { if (!alarm) chrome.alarms.create('flush', { periodInMinutes: 5 }); });
chrome.alarms.onAlarm.addListener(() => void flush());
chrome.runtime.onStartup.addListener(() => void flush());
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await chrome.runtime.openOptionsPage();
});
