import { afterAll,beforeAll,expect,it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled=process.env.RI_SPACES_BROWSER_TEST==='1';let fixture:Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async()=>{if(!enabled)return;fixture=await browserFixture(`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 import {TeamTaskAgentAction} from './src/components/team/team-task-agent-action';
 import {TaskDateField} from './src/components/tasks/task-date-field';import {TaskRow} from './src/components/tasks/task-row';import {StartWithAgentButton} from './src/components/tasks/start-with-agent-button';
 import {installHistoryNavigation} from './src/lib/client/history-navigation';
 window.changes=[];window.rowClicks=0;window.opened=[];window.targets=[];window.launches=[];installHistoryNavigation('darwin');
 function Row(){const [task,setTask]=useState({id:'row',title:'Row task',status:'todo',hardDeadline:null,resurfaceAfter:null});return <TaskRow task={task} onComplete={()=>{}} onSnooze={()=>{}} onArchive={()=>{}} onOpen={id=>window.opened.push(id)} onUpdate={(id,field,value)=>{window.changes.push([field,value]);setTask(t=>({...t,[field]:value}));}}/>;}
 function App(){const [value,setValue]=useState('2026-01-01');if(new URLSearchParams(location.search).has('row'))return <Row/>;if(new URLSearchParams(location.search).has('destinations'))return <TeamTaskAgentAction task={{id:'canonical',title:'Shared task',status:'todo'}}/>;return <main><div onClick={()=>{window.rowClicks+=1;}}><TaskDateField label="Snooze until" value={value} highlightOverdue onChange={date=>{window.changes.push(date);setValue(date);}}/></div><button style={{position:'fixed',top:0,right:0}}>Outside</button><StartWithAgentButton task={{id:'reference',title:'Shared task',status:'todo',sourceTeamId:'team'}}/></main>}
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><App/></QueryClientProvider>);
`,[{name:'task-control-data',setup(b){const modules:Record<string,string>={
 'next/navigation':`export const useRouter=()=>({push:path=>window.opened.push(path)});`,
 'contexts/work-context':`export const useOptionalWorkNavigation=()=>({openExecution:id=>window.opened.push(id)});`,
 'spaces/space-selector':`export const useConnectedTeams=()=>({data:[{id:'team',name:'Team'}]});`,
 'launcher/launcher-store':`export const openLauncher=seed=>window.launches.push(seed);`,
 'home/home-context':`export const useHomeContext=()=>({capabilities:{runTeamAgent:true},executionChoices:[{audience:'team',available:!new URLSearchParams(location.search).has('noTeam')}]});export const useOptionalHomeContext=useHomeContext;`,
 'hooks/use-home-execution-choices':`export const useHomeExecutionChoices=()=>({data:[{audience:'team',available:!new URLSearchParams(location.search).has('noTeam')}]});`,
 'space-root':`export const useSpace=()=>({id:'team',status:'active'});`,
 'shared/area-select':`export const AreaSelect=()=>null;`,
 'tasks/lifecycle-status-control':`export const LifecycleStatusControl=()=>null;`,
 'tasks/task-badges':`export const TaskBadges=()=>null;`,
 'spaces/team-label':`export const TeamLabel=()=>null;`,
 'spaces/my-ri-client':`export const myRiClient={spaces:{personalExecutionChoices:{query:async()=>[{audience:'personal',available:!new URLSearchParams(location.search).has('noPersonal')}]}}};`,
 'lib/trpc/client':`export const trpc={spaces:{personalExecutionChoices:{queryKey:()=>['fixture-personal-execution']}}};export const trpcClient={tasks:{continueTargetsGet:{query:async()=>window.targets}}};`,
 };for(const[name,contents]of Object.entries(modules)){b.onResolve({filter:new RegExp(name+'$')},()=>({path:name,namespace:'data'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'data'},()=>({contents,loader:'tsx',resolveDir:process.cwd()}));}}}]);},120_000);
afterAll(async()=>{await fixture?.close();});
it.skipIf(!enabled).each([['Asia/Tokyo','2026-11-06','Fri, Nov 6','Nov 6, 2026'],['America/Denver','2026-11-05','Thu, Nov 5','Nov 5, 2026']])('types or picks a task date on the local calendar in %s',async(timezoneId,tomorrow,described,shown)=>{
 const page=await fixture.browser.newPage({timezoneId});page.setDefaultTimeout(4000);try{await page.clock.setFixedTime(new Date('2026-11-04T20:00:00Z'));await page.goto(fixture.url);
 const field=page.getByRole('button',{name:/^Snooze until: /}),input=page.getByRole('textbox',{name:'Snooze until'}),outside=page.getByRole('button',{name:'Outside',exact:true}),changes=()=>page.evaluate('window.changes');
 await field.waitFor();expect(await field.getAttribute('class')).toContain('text-red-500');
 // Typed text shows what it read, and saves on leaving.
 await field.click();await expect.poll(()=>input.evaluate(el=>el===document.activeElement)).toBe(true);expect(await input.inputValue()).toBe('Jan 1, 2026');
 await input.fill('tomorrow');await page.getByText(described,{exact:true}).waitFor();expect(await changes()).toEqual([]);await outside.click();await input.waitFor({state:'detached'});expect(await changes()).toEqual([tomorrow]);
 // Escape leaves the date as it was.
 await field.click();await input.fill('dec 25');await input.press('Escape');await input.waitFor({state:'detached'});expect(await changes()).toEqual([tomorrow]);
 await field.click();expect(await input.inputValue()).toBe(shown);
 // Unreadable text holds on Enter and changes nothing on leaving.
 await input.fill('banana');await input.press('Enter');await page.getByText('Not a date',{exact:true}).waitFor();expect(await changes()).toEqual([tomorrow]);
 await outside.click();await input.waitFor({state:'detached'});expect(await changes()).toEqual([tomorrow]);
 // Enter saves typed text, and the calendar follows it.
 await field.click();await input.fill('dec 25');await page.getByText('December 2026',{exact:true}).waitFor();await input.press('Enter');await input.waitFor({state:'detached'});expect(await changes()).toEqual([tomorrow,'2026-12-25']);
 // A picked day saves at once, and clicks inside don't reach the row behind.
 await field.click();const rowClicks=await page.evaluate('window.rowClicks');await page.getByRole('button',{name:/December 31/}).click();await input.waitFor({state:'detached'});expect(await changes()).toEqual([tomorrow,'2026-12-25','2026-12-31']);expect(await page.evaluate('window.rowClicks')).toBe(rowClicks);
 // Clearing saves no date, once.
 await field.click();await page.getByRole('button',{name:'Clear date',exact:true}).click();await input.waitFor({state:'detached'});expect(await changes()).toEqual([tomorrow,'2026-12-25','2026-12-31',null]);await page.getByRole('button',{name:'Snooze until: not set',exact:true}).waitFor();
 }finally{await page.close();}
},25_000);
it.skipIf(!enabled)('opens the date picker and the block box from a row menu and leaves the task closed',async()=>{
 const page=await fixture.browser.newPage({timezoneId:'America/Denver'});page.setDefaultTimeout(4000);try{await page.clock.setFixedTime(new Date('2026-11-04T20:00:00Z'));await page.goto(fixture.url+'/?row');
 const menu=async(item:string)=>{await page.getByText('Row task',{exact:true}).hover();await page.locator('button:has(svg.lucide-ellipsis)').click();await page.getByRole('menuitem',{name:item}).click();};
 const staysFocused=async(field:ReturnType<typeof page.getByRole>)=>{await expect.poll(()=>field.evaluate(el=>el===document.activeElement)).toBe(true);await page.waitForTimeout(400);expect(await field.evaluate(el=>el===document.activeElement)).toBe(true);};
 const date=page.getByRole('textbox',{name:'Deadline',exact:true});
 await menu('Set deadline');await staysFocused(date);await page.getByRole('button',{name:'Go to the Next Month',exact:true}).click();await date.fill('fri');await date.press('Enter');await date.waitFor({state:'detached'});expect(await page.evaluate('window.changes')).toEqual([['hardDeadline','2026-11-06']]);
 const block=page.getByPlaceholder('e.g. waiting on design review');
 await menu('Block');await staysFocused(block);await block.press('Escape');await block.waitFor({state:'detached'});
 await menu('Snooze 1 day');expect(await page.evaluate('window.opened')).toEqual([]);
 await page.getByText('Row task',{exact:true}).click();expect(await page.evaluate('window.opened')).toEqual(['row']);
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
