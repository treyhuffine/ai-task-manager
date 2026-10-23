import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled=process.env.RI_SPACES_BROWSER_TEST==='1';
let fixture:Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async()=>{if(!enabled)return;fixture=await browserFixture(`
 import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TeamAiSection} from './src/components/team/team-ai-settings';
 window.calls=[];window.teamAiStatus={enabled:false,state:'off',hasApiKey:true};
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TeamAiSection/></QueryClientProvider>);
`,[{name:'team-ai-settings-data',setup(b){
 const modules:Record<string,string>={
 'home-context':`export const useOptionalHomeContext=()=>useHomeContext();export const useHomeContext=()=>({home:{kind:'team'},sharedComputer:true,capabilities:{manageSignIns:!location.search.includes('member'),configureAgents:!location.search.includes('member')}});`,
 'team-chat':`import {useQuery} from '@tanstack/react-query';export const useTeamAiStatus=()=>useQuery({queryKey:['status'],queryFn:async()=>({...window.teamAiStatus})});`,
 'ui/confirm-dialog':`export const useConfirm=()=>async()=>true;`,
 'settings/harness-settings-panel':`export const HarnessSettingsPanel=()=>null;`,
 'settings/default-model-section':`export const DefaultModelSection=()=>null;`,
 'results/result-pilot-settings':`export const ResultPilotSettings=()=>null;`,
 'lib/trpc/client':`export const trpc={team:{ai:{status:{queryKey:()=>['status']}}},homeContext:{queryKey:()=>['home']}};export const trpcClient={team:{ai:{setEnabled:{mutate:async input=>{window.calls.push(input);window.teamAiStatus={...window.teamAiStatus,...input};}},forgetKey:{mutate:async()=>{window.calls.push({forget:true});window.teamAiStatus.hasApiKey=false;}}}}};`,
 };
 for(const [name,contents]of Object.entries(modules)){b.onResolve({filter:new RegExp(name+'$')},()=>({path:name,namespace:'data'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'data'},()=>({contents,loader:'tsx',resolveDir:process.cwd()}));}
}}]);},120_000);
afterAll(async()=>{await fixture?.close();});
it.skipIf(!enabled)('warns the owner without blocking AI and preserves the unused key until explicitly removed',async()=>{
 const page=await fixture.browser.newPage();try{await page.goto(fixture.url);await page.getByText('Team agents run on the Team server as its OS user.',{exact:false}).waitFor();
 expect(await page.getByText('Everyone on the team uses this sign-in.',{exact:false}).count()).toBe(1);
 await page.getByRole('button',{name:'Turn on',exact:true}).click();await page.getByRole('button',{name:'Turn off',exact:true}).waitFor();
 expect(await page.evaluate('window.teamAiStatus.hasApiKey')).toBe(true);await page.getByRole('button',{name:'Remove unused key'}).click();await expect.poll(()=>page.evaluate('window.teamAiStatus.hasApiKey')).toBe(false);
 expect(await page.locator('input[type=password]').count()).toBe(0);
 }finally{await page.close();}
},20_000);
it.skipIf(!enabled)('keeps member configuration controls out while preserving the shared state',async()=>{const page=await fixture.browser.newPage();try{await page.goto(fixture.url+'?member');await page.getByText('Off. Tasks and notes work without AI.',{exact:true}).waitFor();expect(await page.getByRole('button',{name:'Turn on',exact:true}).count()).toBe(0);}finally{await page.close();}},20_000);
