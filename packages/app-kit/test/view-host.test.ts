import {it,expect} from 'vitest';
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {prepareHtml} from '@ri/app-kit/build';

it('qualifies opaque relay, SDK callbacks, context and blocked browser capabilities',async()=>{
  const require=createRequire(import.meta.url);
  const executablePath=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(fs.existsSync);
  if(!executablePath)throw new Error('Browser qualification requires a real installed Chromium browser');
  const compile=async(source:string)=>{const result=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',target:'es2023',logLevel:'silent'});return result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');};
  const hostScript=await compile(`import {AppViewController} from ${JSON.stringify(require.resolve('@ri/app-kit/view-host'))};window.AppViewController=AppViewController;`);
  const guestScript=await compile(`import {connectApp} from ${JSON.stringify(require.resolve('@ri/app-kit/app-client'))};(async()=>{
    const result={origin:location.origin,parentBlocked:false,cookieBlocked:false,storageBlocked:false,electron:typeof window.riDesktop};
    try{parent.parent.document.body}catch{result.parentBlocked=true}try{document.cookie}catch{result.cookieBlocked=true}try{localStorage.getItem('private')}catch{result.storageBlocked=true}
    const client=await connectApp();window.client=client;await client.context({selected:['fictional']});
    parent.parent.postMessage({jsonrpc:'2.0',id:99,method:'tools/call',params:{name:'forged',arguments:{}}},'*');
    await client.call('probe',result);
    try{await fetch('/private-mutation',{method:'POST'})}catch{}
    const image=document.createElement('img');image.src='http://127.0.0.1:1/private-image';document.body.append(image);
    const form=document.createElement('form');form.action='http://127.0.0.1:1/private-form';document.body.append(form);form.submit();
    setTimeout(()=>{location.href='http://127.0.0.1:1/private-navigation'},50);
  })();`);
  const guest=prepareHtml(`<html><body><h1>Fictional app</h1><script>${guestScript}</script></body></html>`);
  const server=http.createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(`<html><body><div id="mount" style="height:500px"></div><script>${hostScript}</script></body></html>`);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
  const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR}});
  try{
    const page=await browser.newPage();const requests:string[]=[];const routed:string[]=[];const errors:string[]=[];
    await page.route('**/*',route=>{if(route.request().url().includes('private-'))routed.push(route.request().url());return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(async({guest,id})=>{
      const state=window as unknown as {calls:unknown[];contexts:unknown[];errors:string[];controller:{flushContext():Promise<void>;dispose():Promise<void>};AppViewController:new(mount:HTMLElement,callbacks:unknown)=>unknown};state.calls=[];state.contexts=[];state.errors=[];
      const controller=new state.AppViewController(document.getElementById('mount')!,{call:async(action:string,input:unknown)=>{state.calls.push({action,input});return {};},context:async(value:unknown)=>{state.contexts.push(value);},navigate:()=>{},externalLink:()=>{},error:(error:Error)=>state.errors.push(error.message)}) as {open(resource:unknown,binding:unknown):Promise<void>;flushContext():Promise<void>;dispose():Promise<void>};state.controller=controller;
      await controller.open(guest,{id,packageDigest:'a'.repeat(64),initialData:{fixture:true},path:'/',query:{},theme:'dark'});
    },{guest,id:randomUUID()});
    await page.waitForFunction(()=>((window as unknown as {calls:unknown[]}).calls.length)>0);
    await page.waitForTimeout(300);
    const state=await page.evaluate(()=>({calls:(window as unknown as {calls:unknown[]}).calls,contexts:(window as unknown as {contexts:unknown[]}).contexts,errors:(window as unknown as {errors:string[]}).errors}));
    expect(state.calls).toEqual([{action:'probe',input:{origin:'null',parentBlocked:true,cookieBlocked:true,storageBlocked:true,electron:'undefined'}}]);
    expect(state.contexts).toEqual([{formatVersion:1,revision:1,state:{selected:['fictional']}}]);
    expect(routed).toEqual([]);
    expect(errors).toEqual([]);expect(state.errors).toEqual([]);
    await page.evaluate(async()=>{await(window as unknown as {controller:{dispose():Promise<void>}}).controller.dispose();});
    expect(await page.locator('#mount iframe').count()).toBe(0);
    await page.evaluate(async({guest,id})=>{
      const controller=(window as unknown as {controller:{open(resource:unknown,binding:unknown):Promise<void>;dispose():Promise<void>}}).controller;
      const opening=controller.open(guest,{id,packageDigest:'a'.repeat(64),initialData:{fixture:true},path:'/',query:{},theme:'dark'});
      const closing=controller.dispose();
      await Promise.all([opening,closing]);
    },{guest,id:randomUUID()});
    expect(await page.locator('#mount iframe').count()).toBe(0);
  }finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
