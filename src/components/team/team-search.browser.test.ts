import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TeamSearch}from'./src/components/team/team-search';
    window.selected=[];createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TeamSearch/></QueryClientProvider>);
  `, [{ name:'team-search-data', setup(b) {
    const modules: Record<string,string> = {
      'team-context': `export const useTeam=()=>({member:{id:'me'}});export const useTeamNav=()=>({panel:'search',openPanel:()=>{},openTask:id=>window.selected.push(['task',id]),openNote:id=>window.selected.push(['note',id]),openChat:id=>window.selected.push(['chat',id]),show:id=>window.selected.push(['view',id])});`,
      'use-search': `export const useSearch=(query,mode,kind)=>({data:query?[{id:'task',entityType:'task',title:'Task result',createdAt:'2026-10-20'}, {id:'note',entityType:'note',title:kind==='decision'?'Decision result':'Note result',kind:kind||'note',createdAt:'2026-10-20'}]:[],isFetching:false});`,
      'use-recents': `export const useRecents=()=>({data:[{id:'recent',entityType:'task',title:'Recent shared task',hasBody:false}]});`,
      'use-tasks': `export const useCreateTask=()=>({mutateAsync:async()=>({id:'new-task'})});`,
      'use-notes': `export const useCreateNote=()=>({mutateAsync:async()=>({id:'new-note'})});`,
      'trpc/client': `export const trpc={team:{ai:{searchChats:{queryOptions:input=>({queryKey:['chat-search',input],queryFn:async()=>[]})}}}};`,
      'space-selector': `export const useConnectedTeams=()=>({data:[]});`,
    };
    for(const[name,contents]of Object.entries(modules)){b.onResolve({filter:new RegExp('/'+name+'$')},()=>({path:name,namespace:'search-data'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'search-data'},()=>({contents,loader:'tsx',resolveDir:process.cwd()}));}
  }}]);
},120000);
afterAll(async () => { await fixture?.close(); });
it.skipIf(!enabled)('uses shared prefixes, recents, keyboard commands and Home destinations', async () => {
  const page = await fixture.browser.newPage();page.setDefaultTimeout(8000);page.on('pageerror', error => console.error(error.message));
  try {
    await page.goto(fixture.url);
    await page.getByText('Recent shared task',{exact:true}).waitFor();
    const search = page.getByRole('combobox');
    await search.fill('task: result');
    await page.getByText('Task result',{exact:true}).waitFor();
    expect(await page.getByText('Note result',{exact:true}).count()).toBe(0);
    await search.fill('decision: result');
    await page.getByText('Decision result',{exact:true}).waitFor();
    expect(await page.getByText('Task result',{exact:true}).count()).toBe(0);
    await search.fill('> create task');
    await page.getByText('Create task',{exact:true}).waitFor();
    await search.press('Enter');
    await expect.poll(() => page.evaluate('window.selected')).toContainEqual(['task','new-task']);
    await page.getByText('Recent shared task',{exact:true}).click();
    await expect.poll(() => page.evaluate('window.selected')).toContainEqual(['task','recent']);
  } finally { await page.close(); }
}, 30_000);
