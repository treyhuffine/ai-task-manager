import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

const enabled = process.env.RI_CONVERSATIONS_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { ConversationsSection } from './src/components/settings/sections/conversations-section';
    window.calls = [];
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><main className="mx-auto max-w-2xl p-4"><ConversationsSection /></main></QueryClientProvider>);
  `, [{ name: 'conversation-fixture-data', setup(build) {
    build.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'conversation-client', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'ts', contents: `
      const connection = { id:'12345678-1234-4234-8234-123456789abc', provider:'slack', name:'Ri Personal', enabled:true, channels:['C001'], workspaceId:null, identities:[], error:null };
      let connections = location.search.includes('empty') ? [] : [connection];
      export const trpc = {conversationIntegrations:{list:{queryOptions:()=>({queryKey:['conversations'],queryFn:async()=>({team:location.search.includes('team'),canManage:!location.search.includes('member'),connections:connections.map(item=>({...item,provider:location.search.includes('buzz')?'buzz':item.provider})),agents:[{id:'agent1',name:'Product agent'}]})})}}};
      export const trpcClient = {conversationIntegrations:{
        create:{mutate:async input=>{window.calls.push(input);const created={...connection,...input,id:'23456789-1234-4234-8234-123456789abc'};connections.push(created);return{connection:created,...(input.provider==='buzz'?{bridgeToken:'fixture-token',bridgeUrl:'http://localhost:42241/api/integrations/conversations/acp/test'}:{})};}},
        reconnectSlack:{mutate:async input=>{window.calls.push({operation:'reconnectSlack',...input});return{ok:true};}},
        retryDelivery:{mutate:async()=>({ok:true})},
        setEnabled:{mutate:async input=>{window.calls.push(input);connection.enabled=input.enabled;}},remove:{mutate:async input=>{window.calls.push(input);}},
        link:{mutate:async()=>({command:'link fixture-link-code',bridgeCommand:location.search.includes('buzz')?'curl --fail-with-body fixture-bridge-url':null})},unlink:{mutate:async()=>({ok:true})},manifest:{query:async()=>({display_information:{name:'Ri Personal'}})}
      }};
    ` }));
  } }], { css: true });
}, 120_000);
afterAll(async () => { await fixture?.close(); });

it.skipIf(!enabled)('guides Slack setup from an existing app through tokens, saving and identity linking', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.addInitScript("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedManifest = value; } } });");
    await page.goto(fixture.url + '?empty');
    await page.getByRole('heading', { name: '3. Get your app-level token', exact: true }).waitFor();
    expect(await page.locator('input[type="password"]').evaluateAll(elements => elements.map(element => element.id))).toEqual(['conversation-app-token', 'conversation-bot-token']);
    expect(await page.getByText('Already created the app from a manifest?', { exact: false }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'Open Slack apps', exact: true }).getAttribute('target')).toBe('_blank');
    expect(await page.getByText('OAuth & Permissions', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Bot User OAuth Token', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Basic Information → App-Level Tokens → Generate Token and Scopes', { exact: true }).count()).toBe(1);
    expect(await page.getByText('connections:write', { exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Copy Slack app manifest' }).click();
    await page.getByRole('button', { name: 'Manifest copied', exact: true }).waitFor();
    expect(JSON.parse(await page.evaluate('window.copiedManifest'))).toMatchObject({ display_information: { name: 'Ri Personal' } });
    await page.screenshot({ path: '.work/conversations-slack-setup-desktop.png', fullPage: true });
    await page.getByLabel('App-level token', { exact: true }).fill('xapp-fixture');
    await page.getByLabel('Bot token', { exact: true }).fill('xoxb-fixture');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const saved = page.getByRole('region', { name: 'Ri Personal', exact: true });
    await saved.getByRole('heading', { name: '6. Link yourself and try a message' }).waitFor();
    expect(await page.evaluate('window.calls[0]')).toMatchObject({ provider: 'slack', workspaceId: null, channels: [], botToken: 'xoxb-fixture', appToken: 'xapp-fixture' });
    await saved.getByRole('button', { name: 'Link my Slack identity' }).click();
    await saved.getByText('link fixture-link-code', { exact: true }).waitFor();
    expect(await page.getByLabel('Bot token', { exact: true }).inputValue()).toBe('');
    expect(await page.getByLabel('App-level token', { exact: true }).inputValue()).toBe('');
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('keeps the numbered Slack setup readable on mobile and requires a team agent and channel', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(fixture.url + '?empty&team');
    await page.getByRole('heading', { name: '4. Get your bot token', exact: true }).waitFor();
    expect(await page.getByLabel('Ri destination', { exact: true }).evaluate(element => (element as HTMLSelectElement).required)).toBe(true);
    expect(await page.getByLabel('Connected channel IDs').evaluate(element => (element as HTMLInputElement).required)).toBe(true);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await page.screenshot({ path: '.work/conversations-slack-setup-mobile.png', fullPage: true });
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('explains token locations when reconnecting an existing Slack app and saves the replacement tokens', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 900, height: 1000 } });
  try {
    await page.goto(fixture.url);
    await page.getByRole('button', { name: 'Update Slack tokens' }).click();
    const form = page.getByRole('form', { name: 'Ri Personal Slack tokens' });
    expect(await form.getByText('OAuth & Permissions', { exact: true }).count()).toBe(1);
    expect(await form.getByText('connections:write', { exact: true }).count()).toBe(1);
    await form.getByLabel('New app-level token').fill('xapp-replacement');
    await form.getByLabel('New bot token').fill('xoxb-replacement');
    await form.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await page.waitForFunction('window.calls.some(call => call.operation === "reconnectSlack")');
    expect(await page.evaluate('window.calls[0]')).toMatchObject({ operation: 'reconnectSlack', botToken: 'xoxb-replacement', appToken: 'xapp-replacement' });
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('connects a named Buzz identity and lets the person save then hide its credentials', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(fixture.url);
    await page.getByRole('heading', { name: 'Add a conversation connection' }).waitFor();
    await page.getByLabel('Service', { exact: true }).selectOption('buzz');
    await page.getByLabel('Name', { exact: true }).fill('Ri Team');
    await page.getByLabel('Connected channel IDs').fill('12345678-1234-4234-8234-123456789abc');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('heading', { name: 'Buzz bridge credentials' }).waitFor();
    expect(await page.getByLabel('Buzz bridge environment').inputValue()).toContain('BUZZ_ACP_AGENT_COMMAND=ri');
    expect(await page.evaluate('window.calls[0].name')).toBe('Ri Team');
    await page.screenshot({ path: '.work/conversations-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Hide credentials' }).click();
    expect(await page.getByLabel('Buzz bridge environment').count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('lets a team member link Slack without exposing connection administration, including on mobile', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(fixture.url + '?team&member');
    await page.getByRole('button', { name: 'Link my Slack identity' }).click();
    await page.getByText('link fixture-link-code', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Disconnect', exact: true }).count()).toBe(0);
    expect(await page.getByRole('heading', { name: 'Add a conversation connection' }).count()).toBe(0);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await page.screenshot({ path: '.work/conversations-mobile.png', fullPage: true });
    await page.goto(fixture.url + '?team&member&buzz');
    await page.getByRole('button', { name: 'Authorize my Buzz bridge' }).click();
    await page.getByText('curl --fail-with-body fixture-bridge-url', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Disconnect', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 20_000);
