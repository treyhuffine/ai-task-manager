/** Actual destination, AgentView, AgentTools, AgentChatPanel and New hook.
 * Query transports and individual tool/chat bodies use synthetic data. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TeamChatDestination} from './src/components/team/team-chat-destination';
    import {useTeamNav} from './src/components/team/team-context';
    import {WorkContext} from './src/contexts/work-context';
    import {HomeShell} from './src/components/home/home-shell';
    import {HomeErrorBoundary} from './src/components/home/home-error-boundary';
    window.current=localStorage.getItem('member-current')||'saved-Y';window.requests=[];window.fixed=false;
    window.reorder=()=>{localStorage.setItem('member-current','other-Z');window.current='other-Z';};
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    function Frame(){const nav=useTeamNav();return <HomeShell navigation={<aside>Team navigation</aside>}><WorkContext navigation={{openAgent:nav.openAgent,openExecution:nav.openChat,openTask:nav.openTask,openNote:nav.openNote,goHome:()=>nav.show('board')}} activity={{activeSessionId:nav.chatId,streamingSessionIds:new Set(),backgroundSessionIds:new Set(),pendingInputSessionIds:new Set(),setActiveExecutionId:()=>{},setSessionStreaming:()=>{}}}><TeamChatDestination/></WorkContext></HomeShell>}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><HomeErrorBoundary><Frame/></HomeErrorBoundary></QueryClientProvider>);
  `, [{ name: 'team-navigation-data', setup(build) {
    const modules: Record<string, string> = {
      'next/navigation': `import {useSyncExternalStore} from 'react';const sub=f=>{addEventListener('popstate',f);return()=>removeEventListener('popstate',f)};export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(sub,()=>location.search));export const useRouter=()=>({replace:url=>{history.replaceState(null,'',url);dispatchEvent(new Event('popstate'));},push:url=>{history.pushState(null,'',url);dispatchEvent(new Event('popstate'));}});`,
      '@/hooks/use-workspaces': `const workspace={id:'agent',name:'Shared agent',status:'active'};export const useWorkspaces=()=>({data:[workspace]});export const useWorkspace=()=>({data:workspace});`,
      '@/hooks/use-execution': `import {useQuery} from '@tanstack/react-query';export const useSession=id=>useQuery({queryKey:['fixture-session',id],enabled:!!id,queryFn:async()=>{if(id==='missing'&&!window.fixed)throw new Error('Chat not found');return{id,workspaceId:'agent',executionId:null,label:id,status:'active'};}});`,
      '@/hooks/use-devices': `export const useDevice=()=>null;`,
      '@/components/home/home-context': `export const useHomeStorageScope=()=>'team:member';`,
      '@/lib/trpc/client': `export const trpc={};export const trpcClient={workspaces:{chatGet:{query:async()=>({session:{id:window.current}})},chatNewPost:{mutate:async input=>{window.requests.push(input);window.current='created-'+window.requests.length;return{session:{id:window.current,workspaceId:'agent',executionId:null}};}}}};`,
      '@/components/chat/main-chat-history-menu': `export const MainChatHistoryMenu=()=>null;`,
      '@/components/chat/harness-chat': `import React from 'react';export const HarnessChat=()=> <div>Start a conversation</div>;export const HarnessChatSession=({sessionId,onSwitchProvider})=><section><div>Conversation {sessionId}</div><button onClick={()=>onSwitchProvider({harness:'codex',model:'fixture-codex'})}>Switch model</button></section>;`,
      '@/components/executions/execution-view': `import React from 'react';export const ExecutionView=({sessionId})=><div>Execution {sessionId}</div>;`,
      './agent-header': `import React from 'react';export const AgentHeader=({workspace,pane})=><header><h2>{workspace.name}</h2>{pane&&<><button onClick={()=>pane.onChange('chat')}>Chat pane</button><button onClick={()=>pane.onChange('tools')}>Tools pane</button></>}</header>;`,
      './agent-overview': `import React from 'react';export const AgentOverview=()=> <div>Agent overview</div>;`,
      './agent-files': `import React from 'react';export const AgentFiles=()=> <div>Files body</div>;`,
      './agent-terminal': `import React from 'react';export const AgentTerminal=()=> <div>Terminal body</div>;`,
      './agent-preview': `import React from 'react';export const AgentPreview=()=> <div>Preview body</div>;`,
      './agent-setup': `import React from 'react';export const AgentSetup=()=> <div>Setup body</div>;`,
      '@/components/chat-ui/artifacts/artifact-preview-provider': `export const useBesidePreview=()=>null;export const useBesideRegion=()=>{};`,
      '@/components/chat-ui/artifacts/artifact-beside': `export const BesideFileClose=()=>null;export const BesideFileTab=()=>null;export const BesideFileView=()=>null;`,
      './team-chat': `import React from 'react';export const TeamChat=()=> <div>Choose an agent</div>;export const LegacyTeamChatAgentChoice=()=>null;`,
    };
    build.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: 'team-navigation-data' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'team-navigation-data' }, args => ({ loader: 'tsx', contents: modules[args.path], resolveDir: process.cwd() }));
  }}]);
}, 120_000);
afterAll(async () => { await fixture?.close(); });

it.skipIf(!enabled).each([390, 1280])('retains the linked conversation through Files, Terminal, Preview and reload at %ipx', async width => {
  const page = await fixture.browser.newPage({ viewport: { width, height: 850 } });
  try {
    await page.goto(fixture.url + '?view=chat&chat=linked-X');
    await page.getByText('Conversation linked-X', { exact: true }).waitFor();
    if (width === 390) await page.getByRole('button', { name: 'Tools pane' }).click();
    for (const name of ['Files', 'Terminal', 'Preview']) {
      await page.getByRole('tab', { name, exact: true }).click();
      expect(new URL(page.url()).searchParams.get('chat')).toBe('linked-X');
      await expect.poll(() => page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected')).toBe('true');
    }
    await page.evaluate('window.reorder()');
    await page.reload();
    expect(new URL(page.url()).searchParams.get('chat')).toBe('linked-X');
    if (width === 390) await page.getByRole('button', { name: 'Chat pane' }).click();
    await page.getByText('Conversation linked-X', { exact: true }).waitFor();
  } finally { await page.close(); }
}, 30_000);

it.skipIf(!enabled).each(['New', 'Switch model'])('%s sends the viewed chat as its permission source', async action => {
  const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 850 } });
  try {
    await page.goto(fixture.url + '?view=chat&chat=linked-X');
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => page.evaluate('window.requests.length')).toBe(1);
    expect(await page.evaluate('window.requests[0]')).toMatchObject({ params: { id: 'agent' }, body: { sourceChatId: 'linked-X' } });
    await expect.poll(() => new URL(page.url()).searchParams.get('chat')).toBe('created-1');
    await page.getByText('Conversation created-1', { exact: true }).waitFor();
  } finally { await page.close(); }
});

it.skipIf(!enabled)('keeps navigation on a missing-chat error and retries inside the chat area', async () => {
  const page = await fixture.browser.newPage();
  try {
    await page.goto(fixture.url + '?view=chat&chat=missing');
    await page.getByRole('region', { name: 'Chat unavailable' }).waitFor();
    await page.getByText('Team navigation', { exact: true }).waitFor();
    await page.evaluate('window.fixed=true');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText('Conversation missing', { exact: true }).waitFor();
    await page.getByText('Team navigation', { exact: true }).waitFor();
  } finally { await page.close(); }
});
