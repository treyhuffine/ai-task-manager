import {it,expect} from 'vitest';
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import {containmentViewFixture} from '@ri/app-kit/testing';
it('qualifies native files, theme and independent opaque views in two browser tabs',async()=>{
  const html=await containmentViewFixture(),requests:string[]=[];
  const server=http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(html);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const executablePath=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);if(!executablePath)throw new Error('A real Chromium browser is required');
  const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR}});
  try{for(let index=0;index<2;index++){
    const page=await browser.newPage();await page.route('**/*',route=>{requests.push(route.request().url());return route.continue();});await page.goto(origin);await page.waitForFunction(()=>((window as unknown as {__appProbe:{calls:unknown[]}}).__appProbe?.calls.length)>0);
    const state=await page.evaluate(()=> (window as unknown as {__appProbe:{calls:unknown[];selections:number;downloads:unknown[];errors:unknown[]}}).__appProbe);
    expect(state.calls).toEqual([{action:'probe',input:{origin:'null',parentBlocked:true,cookieBlocked:true,storageBlocked:true,electron:'undefined',node:'undefined',fileName:'fictional.csv'}}]);expect(state.selections).toBe(1);expect(state.downloads).toHaveLength(1);expect(state.errors).toEqual([]);
    await page.evaluate(()=>{(window as unknown as {__controller:{theme(theme:string):void}}).__controller.theme('light');});const guest=page.frames().find(frame=>frame!==page.mainFrame()&&frame.parentFrame()!==page.mainFrame())!;await guest.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await guest.evaluate(()=>{(window as unknown as {__attemptNetworkNavigation:()=>void}).__attemptNetworkNavigation();});await page.waitForTimeout(200);
    await page.evaluate(async()=>{await(window as unknown as {__controller:{dispose():Promise<void>}}).__controller.dispose();});expect(await page.locator('#mount iframe').count()).toBe(0);
  }expect(requests.some(url=>url.includes('blocked.example'))).toBe(false);}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},30000);
