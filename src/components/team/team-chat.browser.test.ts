/** The Team shell uses this ordinary composer. There is no Team-specific transcript or input. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { browserFixture } from '@/test/fixtures/browser-fixture';
const enabled = process.env.RI_SPACES_BROWSER_TEST === '1';
let fixture: Awaited<ReturnType<typeof browserFixture>>;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await browserFixture(`
    import React,{useMemo,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {ChatInputEditor} from './src/components/chat/editor/chat-input-editor';
    import {ScopeProvider} from './src/components/home/home-context';
    import {TipProvider} from './src/components/ui/tip';
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});window.sent=[];
    function Fixture(){const [viewer,setViewer]=useState('maya');const editor=useRef(null);const kind=new URLSearchParams(location.search).get('kind')||'team';
      const scope=useMemo(()=>({homeId:kind==='team'?'team-home':'personal-home',viewerId:kind==='team'?viewer:'local',kind}),[kind,viewer]);window.switchViewer=setViewer;
      return <ScopeProvider value={scope}><ChatInputEditor ref={editor} draftKey="exec:chat" ariaLabel="Chat message" onSubmit={()=>{window.sent.push(editor.current.getMarkerOutput());editor.current.clear();}}/><button onClick={()=>{window.sent.push(editor.current.getMarkerOutput());editor.current.clear();}}>Send</button></ScopeProvider>}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><TipProvider><Fixture/></TipProvider></QueryClientProvider>);
  `, [{ name: 'composer-home-context', setup(b) {
    b.onResolve({ filter: /home\/home-context$/ }, () => ({ path: 'home', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: process.cwd(), contents: `import React,{createContext,useContext} from 'react';const Scope=createContext(null);export const ScopeProvider=Scope.Provider;export const useHomeDocumentScope=()=>useContext(Scope);export const useHomeStorageScope=useHomeDocumentScope;export const useOptionalHomeContext=()=>{const s=useContext(Scope);return s?{home:{id:s.homeId,kind:s.kind},viewer:{id:s.viewerId},capabilities:{privatePlanning:s.kind==='personal'}}:null;};` }));
  }}]);
}, 120_000);
afterAll(async () => { await fixture?.close(); });
it.skipIf(!enabled).each([390,1280])('keeps same-profile drafts with their author and sends only the current member text at %ipx', async width => {
  const page=await fixture.browser.newPage({viewport:{width,height:800}});page.on('pageerror',e=>console.error(e.message));
  try {
    await page.goto(fixture.url);const input=page.getByRole('textbox',{name:'Chat message'});await input.fill('Maya unsent');
    await page.evaluate('window.switchViewer("noa")');await expect.poll(async()=>(await input.innerText()).trim()).toBe('');
    await input.fill('Noa request');await page.getByRole('button',{name:'Send',exact:true}).click();
    expect(await page.evaluate('window.sent')).toEqual([{text:'Noa request',attachments:[]}]);
    await page.evaluate('window.switchViewer("maya")');await expect.poll(async()=>(await input.innerText()).trim()).toBe('Maya unsent');
    await page.reload();await expect.poll(async()=>(await input.innerText()).trim()).toBe('Maya unsent');
  } finally {await page.close();}
},30_000);
it.skipIf(!enabled)('restores a personal draft from before the upgrade without importing it into a Team',async()=>{
  const page=await fixture.browser.newPage();
  try{await page.goto(fixture.url);await page.evaluate(()=>localStorage.setItem('ri:chat-draft:exec:chat',JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Existing personal draft'}]}]})));
    await page.goto(fixture.url+'?kind=personal');const input=page.getByRole('textbox',{name:'Chat message'});await expect.poll(async()=>(await input.innerText()).trim()).toBe('Existing personal draft');
    await page.goto(fixture.url);await expect.poll(async()=>(await input.innerText()).trim()).toBe('');
  }finally{await page.close();}
},30_000);
