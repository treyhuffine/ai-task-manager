// Pressing the button saves. The form only adds tags and a note to what is already safe.
import { parseTags, saveable } from './lib.js';

const $ = (id) => document.getElementById(id);
const setStatus = (text, tone = '') => { $('status').textContent = text; $('status').className = tone; };

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
  // The background worker does the saving, so it finishes even if this popup closes.
  const result = await chrome.runtime.sendMessage({ type: 'save-tab', tab: { id: tab.id, url: tab.url, title: tab.title } });
  if (result.outcome === 'retry') {
    setStatus('Your Ri is out of reach. This page will be saved when it answers.');
  } else if (result.outcome === 'disconnected') {
    setStatus(`${result.message}. Connect again in the extension's options.`, 'bad');
    $('connect').hidden = false;
    $('connect').textContent = 'Open options';
    $('connect').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  } else if (result.outcome === 'rejected' || result.invalid) {
    setStatus(result.message ?? 'This page could not be saved.', 'bad');
    return;
  } else {
    setStatus(result.hasText ? 'Saved with the page text' : 'Saved', 'good');
  }
  $('note').value = result.selection ?? '';
  $('details').hidden = false;
  $('tags').focus();
  $('details').addEventListener('submit', async (event) => {
    event.preventDefault();
    const tags = parseTags($('tags').value);
    const note = $('note').value.trim() || null;
    if (!tags.length && !note) return window.close();
    $('add').disabled = true;
    await chrome.runtime.sendMessage({ type: 'queue', items: [{ via: 'extension', url: tab.url, title: tab.title || null, tags, note }] });
    window.close();
  });
}

void main();
