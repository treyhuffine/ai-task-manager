/**
 * A local stand-in for Composio's API, for trying managed sources in a development home without
 * a real project (docs/connector-service-spec.md). It serves the same REST paths the client uses,
 * plus a pretend consent page, so the whole Connect journey runs in a browser.
 *
 *   pnpm tsx scripts/dev-fake-composio.ts [port]
 *   RI_COMPOSIO_API_BASE=http://127.0.0.1:<port>/api/v3.1 RI_ROOT=/tmp/ri-trial pnpm dev --port 42293
 *
 * Paste `ak_fake_project_key` as the project key. Development only: the app ignores
 * RI_COMPOSIO_API_BASE in production and for any non-loopback address.
 */
import http from 'node:http';
import { createFakeComposio, seedCatalogTools } from '@/lib/integrations/sources/composio/fake-composio';

const port = Number(process.argv[2] ?? 42294);
const base = `http://127.0.0.1:${port}`;
const fake = createFakeComposio({ apiKey: 'ak_fake_project_key', project: { id: 'proj_trial', name: 'Ri trial' }, linkBase: base });
seedCatalogTools(fake);

const today = new Date();
const at = (h: number, m = 0) => { const d = new Date(today); d.setHours(h, m, 0, 0); return d.toISOString(); };
fake.state.results.set('GMAIL_FETCH_EMAILS', () => ({ messages: [
  { messageId: 'm1', threadId: 't1', subject: 'Quarterly plan', sender: 'Dana <dana@example.com>', preview: 'Here is the draft for review' },
  { messageId: 'm2', threadId: 't2', subject: 'Lunch Thursday?', sender: 'Sam <sam@example.com>', preview: 'Are you free?' },
] }));
fake.state.results.set('GOOGLECALENDAR_LIST_CALENDARS', (_args, account) => ({ items: [
  { id: account.email, summary: account.email, primary: true, selected: true, accessRole: 'owner', backgroundColor: '#4285F4' },
] }));
fake.state.results.set('GOOGLECALENDAR_EVENTS_LIST', () => ({ items: [
  { id: 'e1', iCalUID: 'e1@google.com', summary: 'Standup (via Composio)', start: { dateTime: at(9, 30) }, end: { dateTime: at(10) }, status: 'confirmed' },
  { id: 'e2', iCalUID: 'e2@google.com', summary: 'Design review (via Composio)', start: { dateTime: at(14) }, end: { dateTime: at(15) }, status: 'confirmed' },
] }));

function consentPage(accountId: string, callback: string): string {
  const esc = (v: string) => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return `<!doctype html><meta charset="utf-8"><title>Fake Composio consent</title>
<body style="font:14px system-ui;max-width:420px;margin:60px auto">
<h1 style="font-size:18px">Fake Composio: sign in</h1>
<p>This stands in for Google's consent screen. Choose the account the provider reports.</p>
<form method="post" action="/link/${esc(accountId)}">
<input type="hidden" name="callback" value="${esc(callback)}">
<label>Email <input name="email" value="work@example.com" style="width:100%"></label>
<p><button name="decision" value="allow">Allow</button> <button name="decision" value="deny">Deny</button></p>
</form></body>`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', base);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  const link = /^\/link\/([^/]+)$/.exec(url.pathname);
  if (link && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(consentPage(link[1]!, url.searchParams.get('callback') ?? ''));
    return;
  }
  if (link && req.method === 'POST') {
    const form = new URLSearchParams(body);
    const callback = new URL(form.get('callback') ?? '/', base);
    if (form.get('decision') === 'allow') {
      fake.completeLink(link[1]!, form.get('email') ?? 'work@example.com');
      callback.searchParams.set('status', 'success');
    } else {
      const account = fake.state.accounts.find(a => a.id === link[1]);
      if (account) account.status = 'FAILED';
      callback.searchParams.set('status', 'failed');
    }
    callback.searchParams.set('connected_account_id', link[1]!);
    res.writeHead(302, { location: callback.href }).end();
    return;
  }
  const response = await fake.fetch(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(body && req.method !== 'GET' ? { body } : {}) }));
  res.writeHead(response.status, Object.fromEntries(response.headers.entries())).end(Buffer.from(await response.arrayBuffer()));
  console.log(`${req.method} ${url.pathname} → ${response.status}`);
}).listen(port, '127.0.0.1', () => console.log(`Fake Composio on ${base} (key: ak_fake_project_key)`));
