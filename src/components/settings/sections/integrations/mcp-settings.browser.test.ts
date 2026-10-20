/**
 * OpenAI's structured settings on a connection page, with the real section,
 * real Tailwind CSS and Bits & Bolts' real settings. A fake Home records what
 * the page asks of the server: only changed settings are sent, the server
 * judges every value, a refused one stays as entered beside the server's
 * reason, and the library button opens Bits & Bolts' interface in a dialog
 * through the ordinary launch.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { parseSettingsRead } from '@/lib/mcp-apps/settings-model';
import { prepareResource } from '@/lib/mcp-apps/resource';
import { bitsAndBoltsSettings, bitsAndBoltsTools } from '@/test/fixtures/bits-and-bolts-settings';

const viewId = '01900333-3333-7333-8333-333333333333', captureId = '01900222-2222-7222-8222-222222222222', invocationId = captureId;
// A grid size the layout leaves out, so it lands in Other settings and exercises a typed number.
const read = { ...bitsAndBoltsSettings,
  schema: { ...bitsAndBoltsSettings.schema, properties: { ...bitsAndBoltsSettings.schema.properties, gridSize: { type: 'integer', title: 'Grid size', minimum: 1, maximum: 50 } } },
  values: { ...bitsAndBoltsSettings.values, gridSize: 10 } };
const guest = `<html><body><p id="heading">Parts Library</p><script>
addEventListener('message',event=>{const m=event.data;if(m&&m.jsonrpc==='2.0'&&m.id===1&&m.result)parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*')});
parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Parts Library',version:'1.0.0'},appCapabilities:{}}},'*');
</script></body></html>`;
const resource = prepareResource({ contents: [{ uri: 'ui://bits-and-bolts/thread-v35', mimeType: 'text/html;profile=mcp-app', text: guest }] }, 'ui://bits-and-bolts/thread-v35', false);

const calls: { method: string; input: Record<string, unknown> }[] = [];
let values: Record<string, unknown> = { ...read.values };
let server: http.Server, browser: Browser, origin = '';
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync('src/app/globals.css', 'utf8'), { from: path.resolve('src/app/globals.css') });
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {McpServerSettings} from '@/components/settings/sections/integrations/mcp-settings';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
      <main className="bg-background p-6 text-foreground" style={{width: 760}}><McpServerSettings serverId="server" name="Bits & Bolts" enabled /></main>
    </QueryClientProvider>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' } });
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.startsWith('/api/trpc/')) {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || url.searchParams.get('input') || '{}'), method = url.pathname.slice('/api/trpc/'.length);
      calls.push({ method, input });
      let data: unknown;
      if (method === 'mcpSettings.read') data = { available: true, ...parseSettingsRead({ ...read, values }, bitsAndBoltsTools) };
      if (method === 'mcpSettings.update') {
        // The server refuses what its own rules don't allow: a locked choice, and a number past its maximum.
        const set = input.set as Record<string, unknown>;
        const refusal = set.defaultView === 'top' ? 'The top view is unavailable for this library' : typeof set.gridSize === 'number' && set.gridSize > 50 ? 'Grid size must be 50 or less' : null;
        if (refusal) {
          res.statusCode = 500; res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { message: refusal, code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } })); return;
        }
        values = { ...values, ...(input.set as Record<string, unknown>) }; data = { values };
      }
      if (method === 'mcpSettings.runTool') data = { kind: 'app' };
      if (method === 'connectedApps.prepare') data = { kind: 'launch', viewId, invocationId };
      if (method === 'connectedApps.launch') data = { kind: 'opened', captureId };
      if (method === 'connectedApps.open') data = { id: viewId, captureId, serverId: 'server', sourceRef: 'fixture', title: 'Bits & Bolts · Parts Library', resource, input: {}, result: { content: [] }, revision: 0, legacy: false, kind: 'settings', deepLink: null, file: null, modelContext: null, tool: 'cad.library', app: 'Bits & Bolts', icons: [] };
      if (method === 'connectedApps.status') data = { revision: 0, expiresAt: Date.now() + 60_000 };
      if (method === 'transport.capabilities') data = { websocket: false };
      if (data === undefined) { res.statusCode = 500; res.end(`Unexpected ${method}`); return; }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: { data } })); return;
    }
    if (url.pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    res.setHeader('content-type', 'text/html'); res.end('<html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true, args: ['--disable-features=IsolateSandboxedIframes'] });
}, 60_000);
afterAll(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); });

const updates = () => calls.filter(call => call.method === 'mcpSettings.update').map(call => call.input.set);

it('draws Bits & Bolts settings natively, saves only what changes, and opens its library in a dialog', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    const section = page.getByRole('region', { name: 'Settings for Bits & Bolts' });
    await section.getByRole('group', { name: 'Measurements' }).waitFor();
    expect(await section.getByRole('group').evaluateAll(groups => groups.map(group => group.getAttribute('aria-label')))).toEqual(['Measurements', '3D viewer', 'Library', 'Other settings']);

    // A switch saves as it changes, sending only that setting.
    const grid = section.getByRole('switch', { name: 'Show grid' });
    expect(await grid.getAttribute('aria-checked')).toBe('true');
    await grid.click();
    await expect.poll(updates).toEqual([{ showGrid: false }]);
    await expect.poll(() => grid.getAttribute('aria-checked')).toBe('false');

    // A choice saves as it changes.
    await section.getByRole('combobox', { name: 'Units' }).click();
    await page.getByRole('option', { name: 'in', exact: true }).click();
    await expect.poll(updates).toEqual([{ showGrid: false }, { units: 'in' }]);

    // A refused change stays as entered, with the server's reason under it. Choosing the saved value again sends nothing.
    const view = section.getByRole('combobox', { name: 'Default view' });
    await view.click();
    await page.getByRole('option', { name: 'top', exact: true }).click();
    await section.getByText('The top view is unavailable for this library').waitFor();
    await expect.poll(() => view.textContent()).toBe('top');
    await view.click();
    await page.getByRole('option', { name: 'isometric', exact: true }).click();
    await section.getByText('The top view is unavailable for this library').waitFor({ state: 'detached' });
    expect(updates()).toEqual([{ showGrid: false }, { units: 'in' }, { defaultView: 'top' }]);

    // A typed number goes to the server as entered, which judges it. Ri checks no bounds.
    const size = section.getByRole('spinbutton', { name: 'Grid size' });
    await size.fill('80'); await size.press('Enter');
    await section.getByText('Grid size must be 50 or less').waitFor();
    expect(await size.inputValue()).toBe('80');
    await size.fill('20'); await size.press('Enter');
    await section.getByText('Grid size must be 50 or less').waitFor({ state: 'detached' });
    // An empty field holds no number, so nothing is sent and the saved value comes back.
    await size.fill(''); await size.press('Enter');
    await expect.poll(() => size.inputValue()).toBe('20');
    expect(updates()).toEqual([{ showGrid: false }, { units: 'in' }, { defaultView: 'top' }, { gridSize: 80 }, { gridSize: 20 }]);
    await section.screenshot({ path: path.join(process.env.MCP_SETTINGS_SCREENSHOTS ?? '/tmp', 'mcp-settings-section.png') });

    // The library button opens Bits & Bolts' interface through the ordinary launch, as a settings view.
    await section.getByRole('button', { name: 'Parts Library' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('iframe[aria-label="App view"]').waitFor();
    expect(calls.find(call => call.method === 'mcpSettings.runTool')?.input).toEqual({ serverId: 'server', tool: 'cad.library' });
    expect(calls.find(call => call.method === 'connectedApps.prepare')?.input).toEqual({ serverId: 'server', name: 'cad.library', kind: 'settings' });
    expect(await dialog.frameLocator('iframe[aria-label="App view"]').frameLocator('iframe').locator('#heading').textContent()).toBe('Parts Library');
    await page.screenshot({ path: path.join(process.env.MCP_SETTINGS_SCREENSHOTS ?? '/tmp', 'mcp-settings-dialog.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);
