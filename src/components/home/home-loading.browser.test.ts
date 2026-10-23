import fs from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';

const enabled = process.env.RI_HOME_LOADING_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
const captures = process.env.RI_HOME_LOADING_CAPTURES;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryProvider} from './src/providers/query-provider';
    import {HomeBoundary,useHomeContext} from './src/components/home/home-context';
    import {useHomeExecutionChoices} from './src/hooks/use-home-execution-choices';
    import {getQueryClient} from './src/lib/query/client';
    import {trpc,identity} from '@/lib/trpc/client';
    const params=new URLSearchParams(location.search);
    document.documentElement.dataset.riAuthority=identity.home.kind;
    document.documentElement.dataset.riHome=identity.home.id;
    document.documentElement.dataset.riViewer=identity.viewer.id;
    if(params.has('dark'))document.documentElement.classList.add('dark');
    window.changeMember=()=>getQueryClient().setQueryData(trpc.homeContext.queryKey(),{...identity,viewer:{...identity.viewer,id:'replacement'}});
    function Surface(){
      const home=useHomeContext(); const runtime=useHomeExecutionChoices();
      const [tab,setTab]=useState('Tasks'); const [title,setTitle]=useState('Saved task');
      return <main className="p-6 bg-background text-foreground min-h-dvh">
        <nav aria-label="Work"><button onClick={()=>setTab('Tasks')}>Tasks</button><button onClick={()=>setTab('Notes')}>Notes</button><button onClick={()=>setTab('Chat history')}>Chat history</button></nav>
        <h1>{tab}</h1><p>{home.home.name}</p>
        {tab==='Tasks'&&<input aria-label="Task title" value={title} onChange={e=>setTitle(e.target.value)}/>}
        {tab==='Chat history'&&<p>Saved conversation remains readable</p>}
        <p role="status">{runtime.isPending?'Checking agents':runtime.error?'Availability failed':runtime.data[0].available?'Agent ready':'AI unavailable'}</p>
        {runtime.error&&<button onClick={()=>runtime.refetch()}>Retry availability</button>}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<QueryProvider initialHomeContext={params.has('cold')?undefined:identity}><HomeBoundary><Surface/></HomeBoundary></QueryProvider>);
  `, [{ name: 'deferred-home-runtime', setup(build) {
    build.onResolve({ filter: /lib\/trpc\/client$/ }, () => ({ path: 'client', namespace: 'home-fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'home-fixture' }, () => ({ loader: 'tsx', contents: `
      const team=new URLSearchParams(location.search).has('team');
      export const identity={home:{id:'fixture-home',kind:team?'team':'personal',name:'Fixture Home'},viewer:{id:team?'original':'local',name:'Original',role:team?'member':'personal'},capabilities:{privatePlanning:!team},executionChoices:[]};
      window.identityCalls=0; window.runtimeCalls=0;
      export const trpc={
        homeContext:{queryKey:()=>['home'],queryOptions:()=>({queryKey:['home'],queryFn:()=>{window.identityCalls++;return new Promise(resolve=>{window.releaseIdentity=()=>resolve(identity);});}})},
        homeExecutionChoices:{queryKey:()=>['runtime'],queryOptions:()=>({queryKey:['runtime'],queryFn:()=>{window.runtimeCalls++;return new Promise((resolve,reject)=>{window.releaseRuntime=()=>resolve([{available:true}]);window.failRuntime=()=>reject(new Error('Fixture unavailable'));});}})}
      };
    ` }));
  } }], { css: true });
}, 120_000);
afterAll(async () => { await fixture?.close(); });

it.skipIf(!enabled).each(['personal', 'team'])('opens a bootstrapped %s Home without an identity round trip while runtime discovery stays pending', async kind => {
  const page = await fixture.browser.newPage();
  try {
    await page.goto(`${fixture.url}/?${kind}`);
    const title = page.getByRole('textbox', { name: 'Task title' });
    await title.waitFor(); await title.fill('Draft during slow discovery');
    expect(await page.evaluate('window.identityCalls')).toBe(0);
    expect(await page.evaluate('window.runtimeCalls')).toBe(1);
    expect(await page.getByLabel('Loading Home').count()).toBe(0);
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    expect(await page.getByRole('heading', { name: 'Notes', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'Chat history', exact: true }).click();
    expect(await page.getByText('Saved conversation remains readable').count()).toBe(1);
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    expect(await title.inputValue()).toBe('Draft during slow discovery');
    await page.evaluate('window.failRuntime()');
    await page.getByRole('button', { name: 'Retry availability' }).waitFor();
    expect(await title.inputValue()).toBe('Draft during slow discovery');
    await page.getByRole('button', { name: 'Retry availability' }).click();
    await expect.poll(() => page.evaluate('window.runtimeCalls')).toBe(2);
    await page.evaluate('window.releaseRuntime()'); await page.getByText('Agent ready', { exact: true }).waitFor();
    expect(await title.inputValue()).toBe('Draft during slow discovery');
  } finally { await page.close(); }
}, 25_000);

it.skipIf(!enabled).each([390, 1280])('shows anonymous application chrome at %ipx until identity resolves, then mounts without waiting for AI', async width => {
  const page = await fixture.browser.newPage({ viewport: { width, height: 850 } });
  try {
    await page.goto(`${fixture.url}/?team&cold&dark`);
    await page.getByLabel('Loading Home', { exact: true }).waitFor();
    expect(await page.getByRole('textbox').count()).toBe(0);
    expect(await page.locator('[data-slot="skeleton"]').count()).toBeGreaterThan(5);
    expect(await page.evaluate('window.runtimeCalls')).toBe(0);
    expect(await page.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);
    if (captures) { fs.mkdirSync(captures, { recursive: true }); await page.screenshot({ path: `${captures}/pending-${width}.png` }); }
    await page.evaluate('window.releaseIdentity()');
    await page.getByRole('textbox', { name: 'Task title' }).waitFor();
    expect(await page.getByText('Checking agents', { exact: true }).count()).toBe(1);
    expect(await page.getByLabel('Loading Home').count()).toBe(0);
  } finally { await page.close(); }
}, 25_000);

it.skipIf(!enabled)('rejects a member swap after bootstrap without mounting the replacement editor', async () => {
  const page = await fixture.browser.newPage();
  try {
    await page.goto(`${fixture.url}/?team`);
    await page.getByRole('textbox', { name: 'Task title' }).fill('Original member draft');
    await page.evaluate('window.changeMember()');
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('textbox').count()).toBe(0);
    expect(await page.getByRole('alert').innerText()).toContain('drafts are kept for their original author');
  } finally { await page.close(); }
}, 25_000);
