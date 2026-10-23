/** Mounted production destination and navigation, synthetic query data and workbench leaves. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { TeamChatDestination } from './src/components/team/team-chat-destination';
    window.current = new URLSearchParams(location.search).has('empty') ? null : localStorage.getItem('member-current') || 'owner-X';
    window.calls=[]; window.replaces=0; window.chats=['member-Y','owner-X'];
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    window.reorder=()=>{window.chats=['member-Z','member-Y','owner-X'];window.current='member-Y';localStorage.setItem('member-current','member-Y');client.setQueryData(['agent-chat','agent'],{session:{id:'member-Y'}});};
    window.firstSend=()=>{window.current='first-chat';client.setQueryData(['agent-chat','agent'],{session:{id:'first-chat'}});};
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TeamChatDestination/></QueryClientProvider>);
  `, [{ name: 'destination-fixtures', setup(b) {
    const modules: Record<string, string> = {
      'next/navigation': `import {useSyncExternalStore} from 'react';const sub=f=>{addEventListener('popstate',f);return()=>removeEventListener('popstate',f)};export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(sub,()=>location.search));export const useRouter=()=>({replace:url=>{window.replaces++;history.replaceState(null,'',url);dispatchEvent(new Event('popstate'));},push:url=>{history.pushState(null,'',url);dispatchEvent(new Event('popstate'));}});`,
      '@/hooks/use-workspaces': `export const useWorkspaces=()=>({data:[{id:'agent',name:'Shared agent'}]});`,
      '@/hooks/use-execution': `export const useSession=id=>({data:id?{id,workspaceId:'agent',executionId:'execution'}:null});`,
      '@/hooks/use-main-chat': `import {useQuery} from '@tanstack/react-query';export const useMainChat=id=>useQuery({queryKey:['agent-chat',id],queryFn:async()=>{window.calls.push('current');return{session:window.current?{id:window.current}:null};}});`,
      '@/lib/trpc/client': `export const trpc={workspaces:{chatGet:{queryOptions:()=>({queryKey:['current','agent'],queryFn:async()=>{window.calls.push('current');return{session:window.current?{id:window.current}:null};}})}},team:{ai:{chats:{list:{queryOptions:()=>({queryKey:['global-chats'],queryFn:async()=>{window.calls.push('global');return window.chats.map(id=>({id}));}})}}}}};`,
      '@/components/agents/agent-view': `import React from 'react';export const AgentView=({chatSessionId})=><div>{chatSessionId?'Conversation '+chatSessionId:<><div>Start a conversation</div><button onClick={()=>window.firstSend()}>Send first message</button></>}</div>;`,
      '@/components/executions/execution-view': `import React from 'react';export const ExecutionView=({sessionId})=><div>Conversation {sessionId}</div>;`,
      './team-chat': `import React from 'react';export const TeamChat=()=> <div>Choose an agent</div>;export const LegacyTeamChatAgentChoice=()=>null;`,
    };
    b.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: 'destination' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'destination' }, args => ({ loader: 'tsx', contents: modules[args.path], resolveDir: process.cwd() }));
  }}]);
}, 120_000);
afterAll(async () => { await fixture?.close(); });
it.skipIf(!enabled).each([390, 1280])('keeps the owner conversation pinned despite newer member activity at %ipx', async width => {
  const page = await fixture.browser.newPage({ viewport: { width, height: 800 } });
  try {
    await page.goto(fixture.url + '?view=chat');
    await page.getByText('Conversation owner-X', { exact: true }).waitFor();
    await expect.poll(() => new URL(page.url()).searchParams.get('chat')).toBe('owner-X');
    expect(await page.evaluate('history.length')).toBe(2);
    await page.evaluate('window.reorder()');
    await page.getByText('Conversation owner-X', { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get('chat')).toBe('owner-X');
    expect(await page.evaluate('window.calls')).toEqual(['current']);
    await page.reload();
    await page.getByText('Conversation owner-X', { exact: true }).waitFor();
  } finally { await page.close(); }
}, 30_000);
it.skipIf(!enabled)('leaves an agent without a private selection at its start view', async () => {
  const page = await fixture.browser.newPage();
  try {
    await page.goto(fixture.url + '?view=chat&empty=1');
    await page.getByText('Start a conversation', { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.has('chat')).toBe(false);
    expect(await page.evaluate('window.replaces')).toBe(0);
    expect(await page.evaluate('window.calls')).toEqual(['current']);
  } finally { await page.close(); }
});
it.skipIf(!enabled)('pins the first accepted conversation when the shared main-chat cache is seeded', async () => {
  const page = await fixture.browser.newPage();
  try {
    await page.goto(fixture.url + '?view=chat&empty=1');
    await page.getByRole('button', { name: 'Send first message' }).click();
    await page.getByText('Conversation first-chat', { exact: true }).waitFor();
    await expect.poll(() => new URL(page.url()).searchParams.get('chat')).toBe('first-chat');
    await page.evaluate('window.reorder()');
    await page.getByText('Conversation first-chat', { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get('chat')).toBe('first-chat');
  } finally { await page.close(); }
});
