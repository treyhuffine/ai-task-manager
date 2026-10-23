import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let browser: Browser;
let server: http.Server;
let address: string;
beforeAll(async () => {
  if (!enabled) return;
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {TeamLabel} from './src/components/spaces/team-label';
      function Fixture(){const [area,setArea]=useState('Travel and extended family arrangements');return <main className="p-4 space-y-4">
        <h1>Sources in My Ri</h1>
        <div data-testid="source-a"><TeamLabel teamId="a" sourceArea={{name:area}}/></div>
        <div data-testid="source-b"><TeamLabel teamId="b" sourceArea={{name:'Engineering'}}/></div>
        <div data-testid="no-area"><TeamLabel teamId="a"/></div>
        <div data-testid="personal"><TeamLabel teamId={null}/></div>
        <div>Only you <label>Area <input aria-label="My Area" defaultValue="Family"/></label></div>
        <button onClick={()=>setArea('Renamed travel')}>Rename source Area</button>
      </main>}
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env': '{"NODE_ENV":"development"}' },
    plugins: [{ name: 'source-label-data', setup(b) {
      b.onResolve({ filter: /space-selector$/ }, () => ({ path: 'source-data', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useConnectedTeams=enabled=>{window.sourceReads??=[];window.sourceReads.push(enabled);return {data:[{id:'a',name:'Team Huffine'},{id:'b',name:'Team Huffine'}]}};`, loader: 'tsx' }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const cssFile = path.resolve('src/app/globals.css');
  const css = await postcss([require('@tailwindcss/postcss')({ base: process.cwd() })]).process(fs.readFileSync(cssFile, 'utf8'), { from: cssFile });
  server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : request.url === '/style.css' ? 'text/css' : 'text/html');
    response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : request.url === '/style.css' ? css.css : '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
}, 90_000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

it.skipIf(!enabled).each([390, 1280])('keeps full provenance and private organization distinct at %ipx', async width => {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  try {
    await page.goto(address);
    const first = page.getByTestId('source-a');
    await expect.poll(() => first.textContent()).toBe('Team Huffine (a) • Travel and extended family arrangements');
    expect(await page.getByTestId('source-b').textContent()).toBe('Team Huffine (b) • Engineering');
    expect(await page.getByTestId('no-area').textContent()).toBe('Team Huffine (a)');
    expect(await page.getByTestId('personal').textContent()).toBe('');
    await first.locator('span').first().hover();
    await page.getByRole('tooltip').waitFor();
    expect(await page.getByRole('tooltip').textContent()).toBe('Team Huffine (a) • Travel and extended family arrangements');
    await page.getByRole('button', { name: 'Rename source Area' }).click();
    await expect.poll(() => first.textContent()).toBe('Team Huffine (a) • Renamed travel');
    expect(await page.getByRole('textbox', { name: 'My Area' }).inputValue()).toBe('Family');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.RI_ARTIFACT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.RI_ARTIFACT_SCREENSHOTS, `source-label-${width}.png`) });
  } finally { await page.close(); }
}, 20_000);
