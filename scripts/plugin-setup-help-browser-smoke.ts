/** Exercise setup help with the real forms, navigation and tRPC client.
 * Run: pnpm exec tsx scripts/plugin-setup-help-browser-smoke.ts
 * A disposable browser fixture intercepts every API call. No Home or agent is used.
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
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {DashboardProvider, useDashboard} from './src/contexts/dashboard-context';
    import {ConfirmProvider} from './src/components/ui/confirm-dialog';
    import {HostedProviderDetail} from './src/components/settings/sections/integrations/hosted-provider-detail';
    import {McpServerForm, McpServerDetail} from './src/components/settings/sections/integrations/mcp-server-detail';
    import {SkillHeader} from './src/components/skills/skill-header';
    import {openSettings, useSettingsStore} from './src/components/settings/settings-store';
    const provider = ${JSON.stringify(provider)};
    const noop = () => {};
    openSettings('plugins');
    function Fixture() {
      const dashboard = useDashboard(); const settings = useSettingsStore();
      const [form, setForm] = useState({name:'Private service', url:'https://url-user:url-password@seo.example/mcp?key=query-secret#fragment-secret', authKind:'bearer', header:'', secret:'fixture-private-key'});
      const kind = new URLSearchParams(window.location.search).get('fixture');
      const skill = {ref:'draft:review', name:'review', description:null, location:{kind:'draft'}, editable:true, hasErrors:true, uncommitted:false, linkedFrom:null, updatedAt:'now', git:null};
      return <><output data-navigation>{JSON.stringify({view:dashboard.activeView.kind, mobile:dashboard.mobileTab, open:settings.open})}</output>
        {kind === 'mcp' ? <McpServerForm form={form} onChange={patch=>setForm(value=>({...value,...patch}))} busy={false} onSubmit={noop} onBack={noop}/>
          : kind === 'saved' ? <McpServerDetail server={{id:'custom-server',slug:'private',displayName:'Private service',url:'https://seo.example/mcp',enabled:false,auth:{kind:'oauth'},lastStatus:'error'}} busy={false} onBack={noop} onAuthorize={noop} onRetest={noop} onToggleEnabled={noop} onRemove={noop} onToolOverride={noop}/>
          : kind === 'skill' ? <SkillHeader skill={skill}/>
          : <HostedProviderDetail provider={provider} connections={[]} toolkits={[]} writePolicy={{}} busy={false} testing={null} testResults={{}} creds={{}} selectedServices={[]} advancedOpen={false} redirectUri="" copied={false} byoConfigs={[]} byoForm={{label:'',clientId:'',clientSecret:''}}
            onConnectOAuth={noop} onConnectDirect={noop} onBack={noop} onCredChange={noop} onToggleService={noop} onTest={noop} onDisconnect={noop} onSetApproval={noop} onToggleAdvanced={noop} onCopyRedirect={noop} onByoField={noop} onByoAdd={noop} onByoSetDefault={noop} onByoDelete={noop}/>}</>;
    }
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><DashboardProvider><ConfirmProvider><Fixture/></ConfirmProvider></DashboardProvider></QueryClientProvider>);
  `;
  const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', tsconfig: 'tsconfig.json',
    define: { 'process.env': '{"NODE_ENV":"production"}' }, plugins: [{ name: 'fixture-navigation', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useSearchParams=()=>new URLSearchParams(window.location.search); export const usePathname=()=>window.location.pathname;', loader: 'js' }));
    } }] });
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
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
  const address = server.address(); assert(address && typeof address !== 'string');
  const output = path.resolve('.work/plugin-setup-help'); await fs.mkdir(output, { recursive: true });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    for (const width of [1440, 390]) for (const kind of ['openseo', 'mcp', 'saved', 'skill']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors: string[] = []; const sends: { params: { id: string }; body: { id: string; content: string } }[] = [];
      let mainReads = 0; let failNextSend = kind === 'openseo';
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript({ content: "localStorage.setItem('ri.client.apiTransport', 'http');" });
      await page.route('**/api/trpc/**', async route => {
        const procedure = new URL(route.request().url()).pathname.split('/').at(-1)!;
        if (procedure === 'orchestratorChat.list') { mainReads++; await route.fulfill({ json: { result: { data: { session: { id: 'app-main' } } } } }); }
        else if (procedure === 'sessions.messagesPost') {
          sends.push(route.request().postDataJSON());
          await new Promise(resolve => setTimeout(resolve, 100));
          if (failNextSend) { failNextSend = false; await route.fulfill({ status: 500, json: { error: { message: 'Home offline fixture', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } }); }
          else await route.fulfill({ json: { result: { data: { id: sends.at(-1)!.body.id, sessionId: 'app-main' } } } });
        } else if (procedure === 'skills.list') await route.fulfill({ json: { result: { data: { skills: [], projects: [], canWriteGlobal: true } } } });
        else { errors.push(`Unexpected API request: ${procedure}`); await route.abort(); }
      });
      await page.goto(`http://127.0.0.1:${address.port}/?agent=other-agent&fixture=${kind}`);
      const help = page.getByRole('button', { name: 'Get setup help', exact: true });
      await help.waitFor();
      if (kind === 'openseo') {
        await page.getByRole('combobox', { name: 'Deployment' }).selectOption('selfhosted');
        await page.getByLabel('Instance URL', { exact: true }).fill('http://localhost:3000');
        await page.getByRole('combobox', { name: 'Authentication' }).selectOption('none');
      }
      await help.click();
      if (kind === 'openseo') {
        await page.getByRole('alert').filter({ hasText: 'Could not ask your main agent' }).waitFor();
        assert.equal(JSON.parse(await page.locator('[data-navigation]').innerText()).open, true);
        await help.click();
      }
      await page.waitForFunction(() => document.querySelector('[data-navigation]')?.textContent?.includes('"open":false'));
      const navigation = JSON.parse(await page.locator('[data-navigation]').innerText());
      assert.equal(navigation.view, 'home'); assert.equal(navigation.mobile, 'chat');
      assert.equal(mainReads, 1);
      assert(sends.every(send => send.params.id === 'app-main'));
      const message = sends.at(-1)!.body.content;
      for (const secret of ['fixture-private-key', 'url-password', 'query-secret', 'fragment-secret']) assert(!message.includes(secret));
      if (kind === 'openseo') { assert.equal(sends.length, 2); assert.deepEqual(sends[0], sends[1]); assert(message.includes('http://localhost:3000/')); assert(message.includes('local_noauth')); }
      else if (kind === 'mcp') assert(message.includes('https://seo.example/mcp'));
      else if (kind === 'saved') assert(message.includes('custom-server'));
      else assert(message.includes('draft:review'));
      assert.equal(await page.locator('body').evaluate(element => element.scrollWidth > window.innerWidth + 1), false, `Overflow at ${width}px`);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `${kind}-${width}.png`), fullPage: true });
      await page.close(); console.log(`Setup help ${kind} passed at ${width}px`);
    }
  } finally { await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
