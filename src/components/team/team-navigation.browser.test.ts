import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled=process.env.RI_SPACES_BROWSER_TEST==='1';
let fixture:Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async()=>{
  if(!enabled)return;
  fixture=await browserFixture(`
    import React from'react';import{createRoot}from'react-dom/client';
    import{TeamContext,useTeamNav}from'./src/components/team/team-context';import{TeamPhoneBar}from'./src/components/team/team-phone-bar';
    window.creations=[];
    function App(){const nav=useTeamNav();return <><output>{JSON.stringify({view:nav.view,chat:nav.chatId,mine:nav.mine,decisions:nav.decisions})}</output><button onClick={()=>nav.openAgent('agent','files')}>Agent files</button><TeamPhoneBar showChat showAgents/></>}
    createRoot(document.getElementById('root')).render(<TeamContext.Provider value={{team:{id:'team',name:'Team',members:2,hostedOn:null},member:{id:'member',name:'Maya',role:'member'}}}><App/></TeamContext.Provider>);
  `,[{name:'phone-navigation-data',setup(b){
    const modules:Record<string,string>={
      'next/navigation':`import{useSyncExternalStore}from'react';const subscribe=notify=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify)};const navigate=url=>{history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))};export const useRouter=()=>({push:navigate,replace:navigate});export const usePathname=()=>'/team';export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));`,
      'hooks/use-notes':`export const useCreateNote=()=>({mutateAsync:async input=>{window.creations.push({type:'note',input});return{id:'new-note'}}});`,
      'hooks/use-tasks':`export const useCreateTask=()=>({mutateAsync:async input=>{window.creations.push({type:'task',input});return{id:'new-task'}}});`,
    };
    for(const[name,contents]of Object.entries(modules)){b.onResolve({filter:new RegExp(name+'$')},()=>({path:name,namespace:'phone-data'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'phone-data'},()=>({contents,loader:'tsx',resolveDir:process.cwd()}));}
  }}]);
},120_000);
afterAll(async()=>{await fixture?.close();});
it.skipIf(!enabled)('keeps Team session links and clears their alias when opening an agent',async()=>{
 const page=await fixture.browser.newPage();page.setDefaultTimeout(5000);try{
  await page.goto(fixture.url+'/?session=retained-chat');await expect.poll(()=>page.locator('output').innerText()).toContain('"view":"chat","chat":"retained-chat"');
  await page.getByRole('button',{name:'Agent files',exact:true}).click();await expect.poll(()=>page.url()).toContain('view=agents');expect(new URL(page.url()).searchParams.has('session')).toBe(false);expect(new URL(page.url()).searchParams.has('chat')).toBe(false);
 }finally{await page.close();}
});
it.skipIf(!enabled)('creates a decision from Decisions and assigns a phone task from Assigned to me',async()=>{
 const page=await fixture.browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);try{
  await page.goto(fixture.url+'/?view=notes&kind=decision&area=source-area');await page.getByRole('button',{name:'New decision',exact:true}).click();await expect.poll(()=>page.evaluate('window.creations')).toEqual([{type:'note',input:{body:'',kind:'decision',areaId:'source-area'}}]);expect(new URL(page.url()).searchParams.get('note')).toBe('new-note');
  await page.goto(fixture.url+'/?mine=1&area=source-area');await page.getByRole('button',{name:'New task',exact:true}).click();await expect.poll(()=>page.evaluate('window.creations')).toEqual([{type:'task',input:{title:' ',rawInput:' ',assigneeMemberId:'member',areaId:'source-area'}}]);expect(new URL(page.url()).searchParams.get('task')).toBe('new-task');
 }finally{await page.close();}
});
