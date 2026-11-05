// Copies normal bookmarks to Ri and keeps anything unsent until the Home answers.
import { BATCH_SIZE, callHome, forQueue, SAVE_ACTION, saveable, tagsFromFolders } from './lib.js';

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
  return serial(async () => {
    const { queue = [] } = await stored('queue');
    await chrome.storage.local.set({ queue: [...queue, ...items.map(forQueue)].slice(-MAX_QUEUE) });
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
      const batch = queue.slice(0, BATCH_SIZE);
      const via = batch[0].via;
      const same = batch.filter((item) => item.via === via);
      const result = await callHome(fetch, connection, SAVE_ACTION, { via, items: same.map(({ via: _via, ...item }) => item) });
      if (result.outcome === 'retry') return;
      if (result.outcome === 'disconnected') {
        await chrome.storage.local.set({ lastError: result.message, disconnected: true });
        await showState('disconnected');
        return;
      }
      // Sent, or refused for good. Either way it must not hold up what is behind it.
      await serial(async () => {
        const { queue: current = [] } = await stored('queue');
        const sent = new Set(same);
        const remaining = current.filter((item, index) => !(index < batch.length && sent.has(batch[index]) && item.url === batch[index].url));
        await chrome.storage.local.set({ queue: remaining, lastError: result.outcome === 'rejected' ? result.message : null, disconnected: false });
      });
      await showState('ok');
    }
  } finally {
    flushing = false;
  }
}

chrome.bookmarks.onCreated.addListener(async (_id, node) => {
  if (!saveable(node.url)) return;
  const { connection, mirror = true } = await stored(['connection', 'mirror']);
  if (!connection || !mirror) return;
  await enqueue([{ via: 'bookmark', url: node.url, title: node.title || null, savedAt: node.dateAdded ?? null, tags: tagsFromFolders(await folderNames(node.parentId)) }]);
  await flush();
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
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
