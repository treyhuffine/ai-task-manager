// Pressing the button saves. The form only adds tags and a note to what is already safe.
import { callHome, clipText, parseTags, SAVE_ACTION, saveable } from './lib.js';

const $ = (id) => document.getElementById(id);
const setStatus = (text, tone = '') => { $('status').textContent = text; $('status').className = tone; };

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

async function main() {
  const { connection } = await chrome.storage.local.get('connection');
  if (!connection) {
    setStatus('Connect this browser to your Ri first.');
    $('connect').hidden = false;
    $('connect').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }
  $('open').addEventListener('click', () => chrome.tabs.create({ url: connection.app }));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !saveable(tab.url)) {
    setStatus('Only web pages can be saved.');
    return;
  }
  $('title').textContent = tab.title || tab.url;
  $('site').textContent = new URL(tab.url).hostname.replace(/^www\./, '');
  $('page').hidden = false;
  const content = await pageContent(tab.id);
  const base = { url: tab.url, title: tab.title || null };
  const first = { ...base, excerpt: content?.description || null, pageText: clipText(content?.text?.trim()) };
  const result = await callHome(fetch, connection, SAVE_ACTION, { via: 'extension', items: [first] });
  if (result.outcome === 'retry') {
    await chrome.runtime.sendMessage({ type: 'queue', items: [{ via: 'extension', ...first }] });
    setStatus('Your Ri is out of reach. This page will be saved when it answers.');
  } else if (result.outcome === 'disconnected') {
    setStatus(`${result.message}. Connect again in the extension's options.`, 'bad');
    $('connect').hidden = false;
    $('connect').textContent = 'Open options';
    $('connect').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  } else if (result.outcome === 'rejected' || result.body?.invalid) {
    setStatus(result.message ?? 'This page could not be saved.', 'bad');
    return;
  } else {
    setStatus(content?.text ? 'Saved with the page text' : 'Saved', 'good');
  }
  $('note').value = content?.selection?.trim().slice(0, 4000) ?? '';
  $('details').hidden = false;
  $('tags').focus();
  $('details').addEventListener('submit', async (event) => {
    event.preventDefault();
    const tags = parseTags($('tags').value);
    const note = $('note').value.trim() || null;
    if (!tags.length && !note) return window.close();
    $('add').disabled = true;
    const added = await callHome(fetch, connection, SAVE_ACTION, { via: 'extension', items: [{ ...base, tags, note }] });
    if (added.outcome === 'retry') await chrome.runtime.sendMessage({ type: 'queue', items: [{ via: 'extension', ...base, tags, note }] });
    if (added.outcome === 'ok' || added.outcome === 'retry') return window.close();
    $('add').disabled = false;
    setStatus(added.message, 'bad');
  });
}

void main();
