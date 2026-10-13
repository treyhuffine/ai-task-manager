/** Check the real OpenSEO form in an isolated browser fixture.
 * Run: pnpm exec tsx scripts/openseo-browser-smoke.ts
 * No Home is opened and no connector request reaches a real server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser } from 'playwright-core';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { hostedMcpEndpointSetup } from '@/lib/integrations/hosted-endpoint';

async function main() {
  const definition = getHostedMcpProvider('openseo')!;
  const provider = { id: 'openseo', displayName: 'OpenSEO', method: 'mcp', configured: true,
    mcp: { requiresAuth: true, authKind: 'oauth', tokenAuth: definition.tokenAuth, endpointConfig: hostedMcpEndpointSetup(definition), accounts: [] } };
  const source = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { HostedProviderDetail } from './src/components/settings/sections/integrations/hosted-provider-detail';
    import { hostedAccountRequestFields } from './src/components/settings/sections/integrations/hosted-account-request';
    const provider = ${JSON.stringify(provider)};
    window.attempts = [];
    const record = (kind, intent) => window.attempts.push({ kind, body: { ...hostedAccountRequestFields(provider, intent), fields: intent?.fields ?? {} } });
    const noop = () => {};
    createRoot(document.getElementById('root')).render(<HostedProviderDetail provider={provider} connections={[]} toolkits={[]} writePolicy={{}} busy={false} testing={null} testResults={{}} creds={{}} selectedServices={[]} advancedOpen={false} redirectUri="" copied={false} byoConfigs={[]} byoForm={{label:'',clientId:'',clientSecret:''}}
      onConnectOAuth={(_config, intent) => record('oauth', intent)} onConnectDirect={intent => record('direct', intent)}
      onBack={noop} onCredChange={noop} onToggleService={noop} onTest={noop} onDisconnect={noop} onSetApproval={noop} onToggleAdvanced={noop} onCopyRedirect={noop} onByoField={noop} onByoAdd={noop} onByoSetDefault={noop} onByoDelete={noop} />);
  `;
  const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: 'tsconfig.json' });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  // Limit Tailwind discovery to the UI. This fixture never scans another worktree.
  const appCss = (await fs.readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components";');
  const { css } = await postcss([tailwind()]).process(appCss, { from: path.resolve('src/app/globals.css') });
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Chromium is required');
  const server = createServer((request, response) => {
    if (request.url === '/app.js') { response.setHeader('content-type', 'application/javascript'); response.end(bundle.outputFiles[0].text); }
    else if (request.url === '/app.css') { response.setHeader('content-type', 'text/css'); response.end(css); }
    else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main id="root" style="max-width:680px;margin:auto;padding:16px"></main><script src="/app.js"></script></body></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const output = path.resolve('.work/openseo-browser');
  await fs.mkdir(output, { recursive: true });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}`);
      const deployment = page.getByRole('combobox', { name: 'Deployment', exact: true });
      await deployment.waitFor();
      assert.equal(await deployment.inputValue(), 'hosted');
      await page.getByLabel('Account label', { exact: true }).fill('Research');
      await page.getByRole('button', { name: 'Use API key', exact: true }).click();
      const key = page.getByLabel('OpenSEO API key', { exact: true });
      await key.fill('oseo_fixture_key');
      await deployment.selectOption('selfhosted');
      assert.equal(await page.getByRole('button', { name: 'Use API key', exact: true }).count(), 0);
      const auth = page.getByRole('combobox', { name: 'Authentication', exact: true });
      await page.getByLabel('Instance URL', { exact: true }).fill('http://localhost:3000');
      await auth.selectOption('none');
      await page.getByRole('button', { name: 'Connect OpenSEO', exact: true }).click();
      const docker = await page.evaluate(() => (window as unknown as { attempts: { kind: string; body: Record<string, unknown> }[] }).attempts[0]);
      assert.equal(docker.kind, 'direct');
      assert.deepEqual({ endpointId: docker.body.endpointId, instanceUrl: docker.body.instanceUrl, authMethod: docker.body.authMethod, fields: docker.body.fields },
        { endpointId: 'selfhosted', instanceUrl: 'http://localhost:3000', authMethod: 'none', fields: {} });
      await page.screenshot({ path: path.join(output, `docker-${width}.png`), fullPage: true });
      await page.getByLabel('Instance URL', { exact: true }).fill('https://seo.example');
      await auth.selectOption('oauth');
      await page.getByText(/Enable Managed OAuth/).waitFor();
      await page.getByRole('button', { name: 'Connect OpenSEO', exact: true }).click();
      const cloudflare = await page.evaluate(() => (window as unknown as { attempts: { kind: string; body: Record<string, unknown> }[] }).attempts[1]);
      assert.equal(cloudflare.kind, 'oauth');
      assert.equal(cloudflare.body.authMethod, 'oauth');
      assert.equal(cloudflare.body.instanceUrl, 'https://seo.example');
      await page.screenshot({ path: path.join(output, `cloudflare-${width}.png`), fullPage: true });
      await deployment.selectOption('hosted');
      await page.getByRole('button', { name: 'Use API key', exact: true }).click();
      assert.equal(await key.inputValue(), '');
      assert.equal(await page.getByLabel('Instance URL', { exact: true }).count(), 0);
      assert.equal(await page.locator('body').evaluate(element => element.scrollWidth > window.innerWidth + 1), false, `Form overflow at ${width}px`);
      assert.deepEqual(errors, [], `Browser errors at ${width}px`);
      await page.close();
      console.log(`OpenSEO deployment forms passed at ${width}px`);
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
