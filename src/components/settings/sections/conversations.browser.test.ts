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
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><div data-settings-scroll className="h-[90dvh] max-h-[720px] overflow-y-auto"><main className="mx-auto max-w-2xl p-4"><ConversationsSection /></main></div></QueryClientProvider>);
  `, [{ name: 'conversation-fixture-data', setup(build) {
    build.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'conversation-client', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'ts', contents: `
      const connection = { id:'12345678-1234-4234-8234-123456789abc', provider:'slack', name:'Ri Personal', enabled:true, channels:['C001'], workspaceId:null, identities:[], error:null };
      let connections = location.search.includes('empty') ? [] : [connection];
      window.completeSlackLink = id => { connections = connections.map(item => item.id === id ? {...item,identities:[{id:'identity1',externalUserId:'U001',mine:true,memberId:null}]} : item); };
      export const trpc = {conversationIntegrations:{list:{queryOptions:()=>({queryKey:['conversations'],queryFn:async()=>({team:location.search.includes('team'),canManage:!location.search.includes('member'),connections:location.search.includes('stale-list')?[]:connections.map(item=>({...item,provider:location.search.includes('buzz')?'buzz':item.provider})),agents:[{id:'agent1',name:'Product agent'}]})})}}};
      export const trpcClient = {conversationIntegrations:{
        create:{mutate:async input=>{window.calls.push(input);const created={...connection,...input,id:'23456789-1234-4234-8234-123456789abc'};connections.push(created);return{connection:created,...(input.provider==='buzz'?{bridgeToken:'fixture-token',bridgeUrl:'http://localhost:42241/api/integrations/conversations/acp/test'}:{})};}},
        reconnectSlack:{mutate:async input=>{window.calls.push({operation:'reconnectSlack',...input});return{ok:true};}},
        retryDelivery:{mutate:async()=>({ok:true})},
        setEnabled:{mutate:async input=>{window.calls.push(input);connection.enabled=input.enabled;}},remove:{mutate:async input=>{window.calls.push(input);connections=connections.filter(item=>item.id!==input.id);}},
        link:{mutate:async()=>({command:'link fixture-link-code',bridgeCommand:location.search.includes('buzz')?'curl --fail-with-body fixture-bridge-url':null,expiresInMinutes:10})},unlink:{mutate:async()=>({ok:true})},manifest:{query:async()=>({display_information:{name:'Ri Personal'}})}
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
    await saved.getByRole('heading', { name: '6. Link your Slack identity' }).waitFor();
    expect(await saved.getByText('Slack app saved', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('form', { name: 'Add a conversation connection' }).count()).toBe(0);
    expect(await page.evaluate('document.activeElement.id')).toBe('conversation-23456789-1234-4234-8234-123456789abc');
    expect(await saved.evaluate(element => { const box = element.getBoundingClientRect(); const scroll = element.closest('[data-settings-scroll]')!.getBoundingClientRect(); return box.top >= scroll.top && box.top < scroll.bottom; })).toBe(true);
    await saved.getByText('Can’t send a DM to this app?', { exact: true }).click();
    expect(await saved.getByText('Allow users to send Slash commands and messages from the messages tab', { exact: true }).isVisible()).toBe(true);
    expect(await saved.getByRole('link', { name: 'Open Slack app settings', exact: true }).getAttribute('href')).toBe('https://api.slack.com/apps');
    await saved.getByText('Can’t send a DM to this app?', { exact: true }).click();
    expect(await page.evaluate('window.calls[0]')).toMatchObject({ provider: 'slack', workspaceId: null, channels: [], botToken: 'xoxb-fixture', appToken: 'xapp-fixture' });
    await saved.getByRole('button', { name: 'Link my Slack identity' }).click();
    await saved.getByText('link fixture-link-code', { exact: true }).waitFor();
    expect(await saved.getByText('Open a DM with this Slack app and send the command below.', { exact: false }).count()).toBe(1);
    expect(await saved.getByText('Waiting for your Slack message…', { exact: true }).count()).toBe(1);
    expect(await saved.getByRole('heading', { name: '7. Test a two-way conversation' }).count()).toBe(0);
    await saved.getByRole('button', { name: 'Copy link command', exact: true }).click();
    await saved.getByRole('button', { name: 'Link command copied', exact: true }).waitFor();
    await page.screenshot({ path: '.work/conversations-slack-saved-desktop.png', fullPage: true });
    await page.evaluate("window.completeSlackLink('23456789-1234-4234-8234-123456789abc')");
    await saved.getByText('Slack identity linked. You can send a test message now.', { exact: true }).waitFor();
    expect(await saved.getByText('Waiting for your Slack message…', { exact: true }).count()).toBe(0);
    expect(await saved.getByText('link fixture-link-code', { exact: true }).count()).toBe(0);
    expect(await saved.getByRole('heading', { name: '7. Test a two-way conversation' }).count()).toBe(1);
    expect(await saved.getByText('What did I just ask?', { exact: true }).count()).toBe(1);
    expect(await saved.getByText('Slack app saved', { exact: true }).count()).toBe(1);
    await page.screenshot({ path: '.work/conversations-slack-linked-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Add another connection', exact: true }).click();
    expect(await page.getByLabel('Bot token', { exact: true }).inputValue()).toBe('');
    expect(await page.getByLabel('App-level token', { exact: true }).inputValue()).toBe('');
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('shows a saved team connection at the setup location on mobile and checks its channel link', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(fixture.url + '?team');
    await page.getByLabel('Name', { exact: true }).fill('Ri Team');
    await page.getByLabel('Ri destination', { exact: true }).selectOption('agent1');
    await page.getByLabel('App-level token', { exact: true }).fill('xapp-fixture');
    await page.getByLabel('Bot token', { exact: true }).fill('xoxb-fixture');
    await page.getByLabel('Connected channel IDs').fill('C002');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const saved = page.getByRole('region', { name: 'Ri Team', exact: true });
    await saved.getByText('Slack app saved', { exact: true }).waitFor();
    expect(await saved.getByText('Ri Team will talk to Product agent in Ri.', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('region', { name: 'Ri Personal', exact: true }).count()).toBe(1);
    expect(await page.evaluate('document.activeElement.id')).toBe('conversation-23456789-1234-4234-8234-123456789abc');
    expect(await saved.evaluate(element => { const box = element.getBoundingClientRect(); const scroll = element.closest('[data-settings-scroll]')!.getBoundingClientRect(); return box.top >= scroll.top && box.top < scroll.bottom; })).toBe(true);
    await page.screenshot({ path: '.work/conversations-slack-saved-mobile.png', fullPage: true });
    await saved.getByRole('button', { name: 'Link my Slack identity', exact: true }).click();
    await saved.getByText('link fixture-link-code', { exact: true }).waitFor();
    expect(await saved.getByText('and select this Slack app, then paste the command below after the mention.', { exact: false }).count()).toBe(1);
    expect(await saved.getByText('Open a DM', { exact: false }).count()).toBe(0);
    await page.evaluate("window.completeSlackLink('23456789-1234-4234-8234-123456789abc')");
    await saved.getByRole('button', { name: 'Check link', exact: true }).click();
    await saved.getByRole('heading', { name: '7. Test a two-way conversation' }).waitFor();
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  } finally { await page.close(); }
}, 20_000);

it.skipIf(!enabled)('keeps the confirmed save visible before the list catches up and removes it on disconnect', async () => {
  const page = await fixture.browser.newPage({ viewport: { width: 900, height: 1000 } });
  try {
    await page.goto(fixture.url + '?empty&stale-list');
    await page.getByLabel('App-level token', { exact: true }).fill('xapp-fixture');
    await page.getByLabel('Bot token', { exact: true }).fill('xoxb-fixture');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const saved = page.getByRole('region', { name: 'Ri Personal', exact: true });
    await saved.getByText('Slack app saved', { exact: true }).waitFor();
    expect(await page.evaluate('document.activeElement.id')).toBe('conversation-23456789-1234-4234-8234-123456789abc');
    await saved.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('form', { name: 'Add a conversation connection' }).waitFor();
    expect(await saved.count()).toBe(0);
    expect(await page.getByText('Slack app saved', { exact: true }).count()).toBe(0);
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
