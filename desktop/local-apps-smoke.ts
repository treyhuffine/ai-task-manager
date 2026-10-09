/** Real Electron qualification using the shipped preload and viewer trust policy. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {containmentViewFixture} from '@ri/app-kit/testing';
async function main(){
  const require=createRequire(import.meta.url),electron=require('electron') as string;
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ri-app-electron-')),html=await containmentViewFixture(),requests:string[]=[];
  const server=http.createServer((request,response)=>{requests.push(request.url??'');response.setHeader('Content-Type','text/html');response.end(html);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  let child:ReturnType<typeof spawn>|undefined;
  try{
    await build({entryPoints:['desktop/preload.ts'],outfile:path.join(root,'preload.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',external:['electron'],logLevel:'silent'});
    const source=`import {app,BrowserWindow,ipcMain,session} from 'electron';import assert from 'node:assert/strict';import {desktopRequestHeaders} from ${JSON.stringify(path.resolve('desktop/trust.ts'))};import {viewerPermission} from ${JSON.stringify(path.resolve('desktop/viewer-trust.ts'))};
      async function main(){app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});await app.whenReady();
      const ses=session.fromPartition('local-app-qualification'),window=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(root,'preload.cjs'))},session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false}});
      ipcMain.on('desktop:bridge-mode',event=>{event.returnValue=event.senderFrame===window.webContents.mainFrame?'local':'viewer';});ipcMain.on('desktop:appearance',()=>{});
      const requests=[];ses.webRequest.onBeforeSendHeaders((details,callback)=>{requests.push(details.url);callback({requestHeaders:desktopRequestHeaders({headers:details.requestHeaders,url:details.url,origin:${JSON.stringify(origin)},capability:'fixture-native-only',nativeRequest:!details.webContentsId||details.webContentsId===-1,trustedMainFrame:details.webContentsId===window.webContents.id&&details.frame===window.webContents.mainFrame&&details.initiatorOrigin===${JSON.stringify(origin)}})});});
      ses.setPermissionCheckHandler((contents,permission,_origin,details)=>viewerPermission({permission,senderId:contents?.id,windowId:window.webContents.id,isMainFrame:details.isMainFrame,requestingUrl:details.requestingUrl,origin:${JSON.stringify(origin)}}));
      ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
      const errors=[];window.webContents.on('console-message',(_event,_level,message)=>{if(message.includes('Uncaught'))errors.push(message);});
      try{await window.loadURL(${JSON.stringify(origin)});let state;const until=Date.now()+15000;while(Date.now()<until){state=await window.webContents.executeJavaScript('window.__appProbe');if(state?.calls?.length)break;await new Promise(resolve=>setTimeout(resolve,100));}
        assert.equal(await window.webContents.executeJavaScript('typeof window.riDesktop'),'object');
        assert.deepEqual(state.calls,[{action:'probe',input:{origin:'null',parentBlocked:true,cookieBlocked:true,storageBlocked:true,electron:'undefined',node:'undefined',fileName:'fictional.csv'}}]);assert.equal(state.selections,1);assert.equal(state.downloads.length,1);assert.deepEqual(state.contexts,[{formatVersion:1,revision:1,state:{selected:['fictional']}}]);assert.deepEqual(state.errors,[]);assert.deepEqual(errors,[]);
        await window.webContents.executeJavaScript("window.__controller.theme('light')");const guest=window.webContents.mainFrame.frames[0]?.frames[0];assert.ok(guest);let theme;for(let attempt=0;attempt<100;attempt++){theme=await guest.executeJavaScript('document.documentElement.dataset.theme');if(theme==='light')break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(theme,'light');
        await guest.executeJavaScript('window.__attemptNetworkNavigation()');await new Promise(resolve=>setTimeout(resolve,200));
        assert.ok(!requests.some(url=>url.includes('blocked.example')));await window.webContents.executeJavaScript('window.__controller.dispose()');assert.equal(await window.webContents.executeJavaScript("document.querySelectorAll('#mount iframe').length"),0);
        console.log('Electron local app containment, callbacks, files, context, theme and teardown pass');
      }catch(error){console.error(error);app.exit(1);}finally{window.destroy();app.quit();}}void main();`;
    await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile:path.join(root,'main.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',external:['electron'],logLevel:'silent'});
    child=spawn(electron,[path.join(root,'main.mjs')],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:root,TMPDIR:os.tmpdir(),LANG:'en_US.UTF-8',NODE_ENV:'test',ELECTRON_ENABLE_LOGGING:'1'}});
    let output='';for(const stream of [child.stdout!,child.stderr!])stream.on('data',chunk=>{output+=String(chunk);if(output.length>32000)output=output.slice(-32000);});
    const timeout=setTimeout(()=>child?.kill('SIGKILL'),25000);const code=await new Promise<number|null>((resolve,reject)=>{child!.once('exit',resolve);child!.once('error',reject);});clearTimeout(timeout);
    if(code!==0 || !output.includes('Electron local app containment, callbacks, files, context, theme and teardown pass'))throw new Error('Electron qualification failed, code '+code+', signal '+child.signalCode+':\n'+output);if(requests.some(url=>url!=='/'))throw new Error('Guest escaped to the fixture HTTP server');process.stdout.write(output);
  }finally{child?.kill('SIGKILL');await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(root,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
