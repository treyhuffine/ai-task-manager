import { batches, callHome, CHECK_ACTION, flattenTree, originPattern, parseConnectionCode, sendItems } from './lib.js';

const $ = (id) => document.getElementById(id);
const plural = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

async function render() {
  const { connection, mirror = true, queue = [], disconnected, lastError } = await chrome.storage.local.get(['connection', 'mirror', 'queue', 'disconnected', 'lastError']);
  $('connect-section').hidden = !!connection;
  $('connected-section').hidden = !connection;
  $('import-section').hidden = !connection;
  if (!connection) return;
  $('home').textContent = connection.home;
  $('mirror').checked = mirror;
  $('broken').hidden = !disconnected;
  $('broken').textContent = disconnected ? `${lastError ?? 'Your Ri no longer accepts this connection'}. Disconnect, then connect again with a new code.` : '';
  $('queue').hidden = !queue.length;
  $('queue').textContent = queue.length ? `${plural(queue.length, 'link is', 'links are')} waiting to send.` : '';
  const links = flattenTree(await chrome.bookmarks.getTree());
  if (!$('import').dataset.busy) {
    $('import').textContent = `Import ${plural(links.length, 'bookmark', 'bookmarks')}`;
    $('import').disabled = !links.length;
  }
}

$('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = (text) => { $('connect-error').textContent = text; $('connect-error').hidden = !text; };
  error('');
  const connection = parseConnectionCode($('code').value);
  if (!connection) return error('That is not a connection code. Make one in Bookmarks, under Connect, and paste the whole thing.');
  // The browser only shows this prompt straight from the click, so nothing is awaited before it.
  const allowed = await chrome.permissions.request({ origins: [originPattern(connection.home)] });
  if (!allowed) return error(`The extension needs to reach ${connection.home} to save links there.`);
  $('connect-button').disabled = true;
  const check = await callHome(fetch, connection, CHECK_ACTION, {});
  $('connect-button').disabled = false;
  if (check.outcome !== 'ok') return error(check.outcome === 'disconnected' ? 'Your Ri did not accept this code. Make a new one and try again.' : `Could not reach ${connection.home}. Check that your Ri is running, then try again.`);
  await chrome.storage.local.set({ connection, mirror: true, disconnected: false, lastError: null });
  $('code').value = '';
  await chrome.runtime.sendMessage({ type: 'flush' }).catch(() => undefined);
  await render();
});

$('mirror').addEventListener('change', () => chrome.storage.local.set({ mirror: $('mirror').checked }));

$('disconnect').addEventListener('click', async () => {
  const { connection } = await chrome.storage.local.get('connection');
  await chrome.storage.local.remove(['connection', 'disconnected', 'lastError']);
  if (connection) await chrome.permissions.remove({ origins: [originPattern(connection.home)] }).catch(() => undefined);
  await chrome.action.setBadgeText({ text: '' });
  await render();
});

$('import').addEventListener('click', async () => {
  const { connection } = await chrome.storage.local.get('connection');
  if (!connection) return;
  const links = flattenTree(await chrome.bookmarks.getTree());
  $('import').disabled = true;
  $('import').dataset.busy = '1';
  let sent = 0, dropped = 0, problem = null;
  for (const batch of batches(links)) {
    $('import-status').textContent = `Sending ${sent.toLocaleString()} of ${links.length.toLocaleString()}`;
    const result = await sendItems(fetch, connection, 'bookmark', batch);
    sent += result.done - result.dropped;
    dropped += result.dropped;
    if (result.outcome !== 'ok') { problem = result.message; break; }
  }
  delete $('import').dataset.busy;
  $('import').disabled = false;
  const refused = dropped ? ` Your Ri refused ${plural(dropped, 'link', 'links')}.` : '';
  $('import-status').textContent = problem ? `Stopped after ${sent.toLocaleString()}: ${problem}. Import again to continue. Nothing is duplicated.${refused}` : `Sent ${plural(sent, 'bookmark', 'bookmarks')} to Ri.${refused}`;
});

chrome.storage.onChanged.addListener(() => void render());
void render();
