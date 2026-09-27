/** Browser-only installation/offline contract. Uses an isolated HTTP fixture
 * and fresh browser profile, never a real Ri home, credential, or service.
 * Run: RI_BROWSER_EXECUTABLE_PATH=/path/to/chrome pnpm tsx scripts/smoke-phone-web-app.ts
 * A matching Playwright-managed Chromium is used when the override is absent.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import manifest from '../src/app/manifest';

const repo = process.cwd();
async function main() {
let gatewayDown = false;
const publicFiles = new Map([
  ['/notifications-sw.js', 'text/javascript'], ['/offline.html', 'text/html'],
  ...manifest().icons!.map(icon => [icon.src, icon.type!] as [string, string]),
]);
const server = http.createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url!, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    const type = publicFiles.get(url.pathname);
    if (type) {
      response.setHeader('Content-Type', type);
      response.end(await readFile(path.join(repo, 'public', url.pathname)));
    } else if (url.pathname === '/manifest.webmanifest') {
      response.setHeader('Content-Type', 'application/manifest+json');
      response.end(JSON.stringify(manifest()));
    } else if (url.pathname.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ private: 'private-api-fixture' }));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.statusCode = gatewayDown ? 503 : 200;
      response.end(gatewayDown ? 'Gateway unavailable' : `<!doctype html><html><head><title>Ri phone smoke</title><link rel="manifest" href="/manifest.webmanifest"></head><body><h1>Private page fixture</h1><p>private-document-fixture</p><script>navigator.serviceWorker.register('/notifications-sw.js')</script></body></html>`);
    }
  })().catch(error => { response.statusCode = 500; response.end(String(error)); });
});
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.RI_BROWSER_EXECUTABLE_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${origin}/notes/private`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cdp = await context.newCDPSession(page);
  const browserManifest = await cdp.send('Page.getAppManifest');
  assert.equal(browserManifest.errors.length, 0, JSON.stringify(browserManifest.errors));
  assert.equal(JSON.parse(browserManifest.data!).display, 'standalone');
  assert.deepEqual(await page.evaluate(async () => (await fetch('/api/private')).json()), { private: 'private-api-fixture' });
  const cacheContents = await page.evaluate(async () => {
    const result: { name: string; urls: string[]; text: string[] }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      result.push({ name, urls: keys.map(key => new URL(key.url).pathname), text: await Promise.all(keys.map(async key => (await cache.match(key))!.text())) });
    }
    return result;
  });
  assert.equal(cacheContents.length, 1);
  assert.deepEqual(cacheContents[0].urls, ['/offline.html']);
  assert(!JSON.stringify(cacheContents).includes('private-document-fixture'));
  assert(!JSON.stringify(cacheContents).includes('private-api-fixture'));

  await context.setOffline(true);
  const offlineResponse = await page.reload();
  assert.equal(offlineResponse!.status(), 503);
  assert((await page.locator('h1').innerText()).includes('out of reach'));
  assert(!(await page.content()).includes('private-document-fixture'));
  assert.equal(await page.evaluate(async () => {
    try { await fetch('/api/private'); return 'unexpected cached API'; } catch { return 'network failure'; }
  }), 'network failure');
  await page.screenshot({ path: path.join(os.tmpdir(), 'ri-phone-offline-smoke.png') });

  await context.setOffline(false);
  await page.getByRole('link', { name: 'Reconnect to Ri' }).click();
  await page.waitForURL(`${origin}/`);
  assert.equal(await page.locator('h1').innerText(), 'Private page fixture');
  gatewayDown = true;
  assert.equal((await page.reload())!.status(), 503);
  assert((await page.locator('h1').innerText()).includes('out of reach'));
  console.log(JSON.stringify({ passed: true, manifest: 'parsed by Chromium', cachedResponses: ['/offline.html'], offlineNavigation: 503, authenticatedApiOffline: 'network failure', reconnect: true, gatewayFallback: 503 }, null, 2));
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
