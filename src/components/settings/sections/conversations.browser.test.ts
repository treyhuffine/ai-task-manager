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
      export const trpc = {conversationIntegrations:{list:{queryOptions:()=>({queryKey:['conversations'],queryFn:async()=>({team:location.search.includes('team'),canManage:!location.search.includes('member'),connections:[{...connection,provider:location.search.includes('buzz')?'buzz':'slack'}],agents:[{id:'agent1',name:'Product agent'}]})})}}};
      export const trpcClient = {conversationIntegrations:{
        create:{mutate:async input=>{window.calls.push(input);return{connection:{...connection,...input},bridgeToken:'fixture-token',bridgeUrl:'http://localhost:42241/api/integrations/conversations/acp/test'};}},
        setEnabled:{mutate:async input=>{window.calls.push(input);connection.enabled=input.enabled;}},remove:{mutate:async input=>{window.calls.push(input);}},
        link:{mutate:async()=>({command:'link fixture-link-code',bridgeCommand:location.search.includes('buzz')?'curl --fail-with-body fixture-bridge-url':null})},unlink:{mutate:async()=>({ok:true})},manifest:{query:async()=>({display_information:{name:'Ri Personal'}})}
      }};
    ` }));
  } }], { css: true });
}, 120_000);
afterAll(async () => { await fixture?.close(); });

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
