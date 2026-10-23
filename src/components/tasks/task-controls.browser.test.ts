import { afterAll,beforeAll,expect,it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled=process.env.RI_SPACES_BROWSER_TEST==='1';let fixture:Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async()=>{if(!enabled)return;fixture=await browserFixture(`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 import {TeamTaskAgentAction} from './src/components/team/team-task-agent-action';
 import {TaskDateField} from './src/components/tasks/task-date-field';import {StartWithAgentButton} from './src/components/tasks/start-with-agent-button';
 import {installHistoryNavigation} from './src/lib/client/history-navigation';
 window.changes=[];window.opened=[];window.targets=[];window.launches=[];installHistoryNavigation('darwin');
 function App(){const [value,setValue]=useState('2026-01-01');if(new URLSearchParams(location.search).has('destinations'))return <TeamTaskAgentAction task={{id:'canonical',title:'Shared task',status:'todo'}}/>;return <main><TaskDateField label="Snooze until" value={value} highlightOverdue onChange={date=>{window.changes.push(date);setValue(date);}}/><button>Outside</button><StartWithAgentButton task={{id:'reference',title:'Shared task',status:'todo',sourceTeamId:'team'}}/></main>}
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);
`,[{name:'task-control-data',setup(b){const modules:Record<string,string>={
 'next/navigation':`export const useRouter=()=>({push:path=>window.opened.push(path)});`,
 'contexts/work-context':`export const useOptionalWorkNavigation=()=>({openExecution:id=>window.opened.push(id)});`,
 'spaces/space-selector':`export const useConnectedTeams=()=>({data:[{id:'team',name:'Team'}]});`,
 'launcher/launcher-store':`export const openLauncher=seed=>window.launches.push(seed);`,
 'home/home-context':`export const useHomeContext=()=>({capabilities:{runTeamAgent:true},executionChoices:[{audience:'team',available:!new URLSearchParams(location.search).has('noTeam')}]});export const useOptionalHomeContext=useHomeContext;`,
 'hooks/use-home-execution-choices':`export const useHomeExecutionChoices=()=>({data:[{audience:'team',available:!new URLSearchParams(location.search).has('noTeam')}]});`,
 'space-root':`export const useSpace=()=>({id:'team',status:'active'});`,
 'spaces/my-ri-client':`export const myRiClient={spaces:{personalExecutionChoices:{query:async()=>[{audience:'personal',available:!new URLSearchParams(location.search).has('noPersonal')}]}}};`,
 'lib/trpc/client':`export const trpc={spaces:{personalExecutionChoices:{queryKey:()=>['fixture-personal-execution']}}};export const trpcClient={tasks:{continueTargetsGet:{query:async()=>window.targets}}};`,
 };for(const[name,contents]of Object.entries(modules)){b.onResolve({filter:new RegExp(name+'$')},()=>({path:name,namespace:'data'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'data'},()=>({contents,loader:'tsx',resolveDir:process.cwd()}));}}}]);},120_000);
afterAll(async()=>{await fixture?.close();});
it.skipIf(!enabled).each(['Asia/Tokyo','America/Denver'])('commits a calendar date only on blur or Enter and restores Escape in %s',async timezoneId=>{
 const page=await fixture.browser.newPage({timezoneId});try{await page.goto(fixture.url);const date=page.getByRole('textbox',{name:'Snooze until'}).or(page.locator('input[type=date]'));await date.waitFor();expect(await date.getAttribute('data-cancel-on-escape')).toBe('');expect(await date.getAttribute('class')).toContain('text-red-500');
 await date.fill('2026-11-02');expect(await page.evaluate('window.changes')).toEqual([]);await page.getByRole('button',{name:'Outside',exact:true}).click();expect(await page.evaluate('window.changes')).toEqual(['2026-11-02']);
 await date.fill('2026-11-03');await date.press('Escape');expect(await date.inputValue()).toBe('2026-11-02');expect(await page.evaluate('window.changes')).toEqual(['2026-11-02']);
 await date.fill('2026-11-04');await date.press('Enter');expect(await page.evaluate('window.changes')).toEqual(['2026-11-02','2026-11-04']);
 }finally{await page.close();}
},25_000);
it.skipIf(!enabled)('reuses one associated chat and offers a chooser for several instead of always launching anew',async()=>{
 const page=await fixture.browser.newPage();try{await page.goto(fixture.url);const button=page.getByRole('button',{name:'Work with agent',exact:true});
 await page.evaluate('window.targets=[{executionId:"execution",sessionId:"existing",label:"Existing work"}]');await button.click();await expect.poll(()=>page.evaluate('window.opened')).toEqual(['existing']);expect(await page.evaluate('window.launches.length')).toBe(0);
 await page.evaluate('window.targets=[{executionId:"one",sessionId:"one-chat",label:"First work"},{executionId:"two",sessionId:"two-chat",label:"Second work"}]');await button.click();await page.getByRole('button',{name:'Second work',exact:true}).click();expect(await page.evaluate('window.opened')).toEqual(['existing','two-chat']);
 await page.evaluate('window.targets=[]');await button.click();await expect.poll(()=>page.evaluate('window.launches.length')).toBe(1);
 }finally{await page.close();}
},25_000);
it.skipIf(!enabled)('shares Back and Forward keys, mouse buttons and menu events with a viewer that has no personal bridge',async()=>{
 const page=await fixture.browser.newPage();try{await page.goto(fixture.url);await page.evaluate('history.pushState({},"","?one");history.pushState({},"","?two")');
 await page.keyboard.press('Meta+[');await expect.poll(()=>page.url()).toBe(fixture.url+'/?one');
 await page.evaluate('window.dispatchEvent(new CustomEvent("ri-history-navigation",{detail:"forward"}))');await expect.poll(()=>page.url()).toBe(fixture.url+'/?two');
 await page.evaluate('window.dispatchEvent(new MouseEvent("mouseup",{button:3,bubbles:true,cancelable:true}))');await expect.poll(()=>page.url()).toBe(fixture.url+'/?one');
 expect(await page.evaluate('window.riDesktop')).toBeUndefined();
 }finally{await page.close();}
},25_000);

it.skipIf(!enabled)('offers one work entry and names the available destinations and audiences',async()=>{
 const page=await fixture.browser.newPage();page.setDefaultTimeout(5000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));try{
 await page.goto(fixture.url+'/?destinations');await page.getByRole('button',{name:'Work with agent',exact:true}).click();
 await page.getByRole('button',{name:"Work on team's server",exact:true}).waitFor();await page.getByRole('button',{name:'Work in My Ri',exact:true}).waitFor();
 expect(await page.getByText('Everyone on the team can read the chat.',{exact:true}).count()).toBe(1);expect(await page.getByText('Your personal agents. Only you can read the chat.',{exact:true}).count()).toBe(1);
 await page.goto(fixture.url+'/?destinations&noPersonal');await page.getByRole('button',{name:"Work on team's server",exact:true}).waitFor();expect(await page.getByRole('button',{name:'Work with agent',exact:true}).count()).toBe(0);
 await page.goto(fixture.url+'/?destinations&noTeam');await page.getByRole('button',{name:'Work in My Ri',exact:true}).waitFor();expect(await page.getByRole('button',{name:'Work with agent',exact:true}).count()).toBe(0);
 }catch(error){throw new Error(JSON.stringify({errors,body:await page.locator('body').innerText()}),{cause:error});}finally{await page.close();}
},25_000);
