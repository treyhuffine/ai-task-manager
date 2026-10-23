import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const source = path.resolve('src/app/globals.css');
  const css = await postcss([require('@tailwindcss/postcss')()]).process(fs.readFileSync(source,'utf8'),{from:source});
  fixture = await browserFixture(`
    import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{AreaSlideout}from'./src/components/dashboard/area-slideout';import{AreasSheet}from'./src/components/dashboard/areas-sheet';
    document.documentElement.dataset.riDesktop='darwin';const style=document.createElement('style');style.textContent=${JSON.stringify(css.css)};document.head.append(style);
    const close=()=>window.closedSheet=true;const list=new URLSearchParams(location.search).has('list');
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}>{list?<AreasSheet open onOpenChange={close}/>:<AreaSlideout areaId="area" onClose={close} onCloseAll={close} hasHistory={false}/>}</QueryClientProvider>);
  `,[{name:'area-fixture',setup(b){
    const modules:Record<string,string>={
      'hooks/use-areas':`const area={id:'area',name:'Research',status:'active',description:'Area context',attachments:[]};export const useArea=()=>({data:area});export const useAreas=()=>({data:[area]});export const useUpdateArea=()=>({mutate:()=>{},mutateAsync:async()=>area});`,
      'hooks/use-tasks':`export const useTasks=()=>({data:[]});export const useCreateTask=()=>({mutateAsync:async()=>({})});`,
      'hooks/use-notes':`export const useNotes=()=>({data:[]});export const useCreateNote=()=>({mutateAsync:async()=>({})});`,
      'hooks/use-task-lifecycle':`export const useTaskLifecycle=()=>({});`,
      'hooks/use-document-autosave':`export const useDocumentAutosave=()=>({edit:()=>{},flush:()=>{}});export const usePendingDocument=(_r,_id,saved)=>saved;`,
      'contexts/dashboard-context':`export const useDashboard=()=>({openTask:()=>{},openNote:()=>{},openArea:()=>{}});`,
      'area-create-modal':`export const AreaCreateModal=()=>null;`,
    };
    for(const[name,contents]of Object.entries(modules)){b.onResolve({filter:new RegExp(name+'$')},()=>({path:name,namespace:'area-data'}));b.onLoad({filter:new RegExp('^'+name+'$'),namespace:'area-data'},()=>({contents,loader:'tsx',resolveDir:process.cwd()}));}
  }}]);
},120_000);
afterAll(async()=>{await fixture?.close();});
it.skipIf(!enabled).each([false,true])('keeps the actual Area sheet controls below the Mac 40px drag strip (list=%s)',async list=>{
  const page=await fixture.browser.newPage({viewport:{width:1280,height:860}});page.setDefaultTimeout(5000);
  try{
    await page.goto(fixture.url+(list?'/?list':''));
    const sheet=page.locator('[data-slot="sheet-content"]');await sheet.waitFor();
    await expect.poll(async()=>Math.round((await sheet.boundingBox())!.y)).toBe(40);
    const close=page.getByRole('button',{name:list?'Close':'Back',exact:true});
    expect((await close.boundingBox())!.y).toBeGreaterThanOrEqual(40);
    await close.click();expect(await page.evaluate('window.closedSheet')).toBe(true);
    expect(await page.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);
  }finally{await page.close();}
},25000);
