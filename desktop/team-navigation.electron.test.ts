/** Source Electron, CDP input and fixture pages. No personal service or native-input claim. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
const enabled = process.env.RI_TEAM_NAV_ELECTRON === '1';
it.skipIf(!enabled)('runs the sandboxed Team navigation preload with CDP keys, buttons and the menu handler, without a personal bridge', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-team-navigation-electron-'));
  const server = http.createServer((req, res) => { if (req.url === '/api/session') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); return; } res.setHeader('content-type','text/html'); res.end('<!doctype html><button>Fixture page</button>'); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const preload = path.join(root,'team-navigation.cjs');
    fs.copyFileSync(path.resolve('dist/desktop/team-navigation.cjs'), preload);
    expect(fs.readFileSync(preload,'utf8')).not.toMatch(/require\(["']react["']\)/);
    await build({ entryPoints:['desktop/team-window.ts'], outfile:path.join(root, 'team-window.cjs'), bundle:true, platform:'node', format:'cjs', external:['electron'], tsconfig:'tsconfig.json' });
    await build({ entryPoints:['desktop/history-menu.ts'], outfile:path.join(root, 'history-menu.cjs'), bundle:true, platform:'node', format:'cjs', external:['electron'], tsconfig:'tsconfig.json' });
    const main = path.join(root,'main.cjs');
    fs.writeFileSync(main, `
      const {app,BrowserWindow,Menu}=require('electron');
      app.setPath('userData',${JSON.stringify(path.join(root,'user-data'))});
      const assert=(value,message)=>{if(!value)throw Error(message)};
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      let window;
      async function wait(query){for(let i=0;i<250;i++){if((new URL(window.webContents.getURL())).search===query)return;await pause(20);}throw Error('History did not reach '+query+' from '+window.webContents.getURL());}
      app.whenReady().then(async()=>{
        const manager=require('./team-window.cjs').teamWindows({background:()=> '#ffffff'});
        await manager.open({id:'test-team',name:'Fixture Team',origin:${JSON.stringify(origin)},token:'fictional-member-token'});
        window=BrowserWindow.getAllWindows()[0];
        const preferences=window.webContents.getLastWebPreferences();
        assert(preferences.sandbox===true&&preferences.contextIsolation===true&&preferences.nodeIntegration===false,'The Team window is not sandboxed');
        const failures=[];window.webContents.on('preload-error',(_e,_p,error)=>failures.push(error.message));
        await window.loadURL(${JSON.stringify(origin)});window.webContents.debugger.attach('1.3');
        app.focus({steal:true});window.show();window.focus();window.webContents.focus();
        for(let i=0;i<250&&!await window.webContents.executeJavaScript('document.hasFocus()');i++)await pause(20);
        assert(await window.webContents.executeJavaScript('document.hasFocus()'),'The Team document must be focused before keyboard input');
        await window.webContents.executeJavaScript('history.pushState({},"","?one");history.pushState({},"","?two")');
        const modifier=process.platform==='darwin'?4:2;
        for(const [key,code,windowsVirtualKeyCode,wanted]of [['[','BracketLeft',219,'?one'],[']','BracketRight',221,'?two']]){for(const type of ['keyDown','keyUp'])await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key,code,modifiers:modifier,windowsVirtualKeyCode});await wait(wanted);}
        for(const [button,wanted]of [['back','?one'],['forward','?two']]){await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:80,y:80,button,clickCount:1});await wait(wanted);}
        const menu=Menu.buildFromTemplate(require('./history-menu.cjs').historyMenuItems());menu.getMenuItemById('history-back').click(null,window);await wait('?one');
        assert(!failures.length,'Preload failed: '+failures.join(','));
        const viewer=await window.webContents.executeJavaScript('({bridge:typeof window.riDesktop,node:typeof require,width:innerWidth,height:innerHeight})');
        assert(viewer.bridge==='undefined'&&viewer.node==='undefined','Personal or Node authority leaked');
        console.log('NAVIGATION_RESULT='+JSON.stringify({sourceCommit:process.env.RI_VERIFICATION_COMMIT||'working-tree',platform:process.platform,arch:process.arch,electron:process.versions.electron,buildMode:'real Team window and history helper bundled from source, actual dist/desktop/team-navigation.cjs preload',input:'Electron CDP key/mouse dispatch, menu callback invocation',checks:['back key','forward key','mouse back','mouse forward','menu callback','sandbox','no personal bridge'],geometry:viewer}));
        window.destroy();app.exit(0);
      }).catch(error=>{console.error(error.stack);if(window)window.destroy();app.exit(1)});
    `);
    const executable = createRequire(import.meta.url)('electron') as string;
    const env: NodeJS.ProcessEnv = { ...process.env, RI_ROOT:root }; delete env.ELECTRON_RUN_AS_NODE;
    const {stdout} = await promisify(execFile)(executable,[main],{timeout:45_000,env});
    const record=stdout.split('\n').find(line=>line.startsWith('NAVIGATION_RESULT='));expect(record).toBeTruthy();
    const result=JSON.parse(record!.slice('NAVIGATION_RESULT='.length));expect(result.checks).toHaveLength(7);
    if(process.env.RI_VERIFICATION_OUTPUT)fs.writeFileSync(process.env.RI_VERIFICATION_OUTPUT,JSON.stringify(result,null,2)+'\n');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); fs.rmSync(root,{recursive:true,force:true}); }
},60_000);
