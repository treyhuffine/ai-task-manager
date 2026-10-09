/** Run only against a disposable Home, through `pnpm iso <root> -- ...`. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright-core';

async function main() {
const root=process.env.RI_ROOT;
assert(root && ![path.join(os.homedir(),'ri'),path.join(os.homedir(),'ri-dev'),path.join(os.homedir(),'ri-test')].includes(path.resolve(root)), 'Use an isolated, disposable Home');
const config=JSON.parse(await fs.readFile(path.join(root,'.config/config.json'),'utf8'));
assert(config.globalSkillEnabled===false,'Disposable Home must disable global skills');
const base=process.env.RI_LOCAL_APPS_BROWSER_URL??'http://127.0.0.1:42251';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use a loopback fixture server');
const executablePath=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
assert(executablePath,'Install Chromium for browser qualification');
const browser=await chromium.launch({executablePath,headless:true});
try {
  const page=await browser.newPage();
  page.on('pageerror', error=>console.error(error.message));
  const draft=process.argv[2];
  await page.goto(`${base}/apps${draft?`/drafts/${draft}`:''}#token=${encodeURIComponent(config.localToken)}`);
  if(!draft){await page.getByRole('button',{name:'New app',exact:true}).click();}
  await page.getByRole('button',{name:'Build preview',exact:true}).click();
  console.log('Building preview');
  await page.getByRole('button',{name:'Use app',exact:true}).waitFor({state:'visible',timeout:180000});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Use app'&&!button.disabled),{},{timeout:180000});
  console.log('Preview validated');
  async function guest() {
    for(let attempt=0;attempt<100;attempt++) {
      for(const frame of page.frames()) {
        if(frame.parentFrame() && await frame.getByRole('textbox',{name:'Record title'}).count())return frame;
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await page.screenshot({path:path.join(root!,'local-apps-browser-failure.png'),fullPage:true});
    console.error('Native alerts',await page.getByRole('alert').allTextContents());
    console.error('Frames',await Promise.all(page.frames().map(async frame=>({url:frame.url().split('#')[0],body:(await frame.locator('body').innerText()).slice(0,500)}))));
    throw new Error('The tracker guest did not become ready');
  }
  const preview=await guest();
  console.log('Preview ready');
  await preview.getByRole('textbox',{name:'Record title'}).fill('Preview record');
  await preview.getByRole('button',{name:'Add',exact:true}).click();
  await preview.getByRole('button',{name:'Preview record',exact:true}).waitFor();
  await page.getByRole('button',{name:'Use app',exact:true}).click();
  await page.getByRole('button',{name:'Change app',exact:true}).waitFor({timeout:60000});
  const installed=await guest();
  assert.equal(await installed.getByRole('button',{name:'Preview record',exact:true}).count(),0,'Preview records leaked into installed data');
  await installed.getByRole('textbox',{name:'Record title'}).fill('Installed record');
  await installed.getByRole('button',{name:'Add',exact:true}).click();
  await installed.getByRole('button',{name:'Installed record',exact:true}).waitFor();
  await installed.getByRole('textbox',{name:'Record title'}).fill('Keep this unsent input');
  await page.waitForTimeout(6500);
  assert.equal(await installed.getByRole('textbox',{name:'Record title'}).inputValue(),'Keep this unsent input','Polling replaced guest input');
  const installedURL=page.url();
  await page.locator('header').getByRole('button',{name:'Apps',exact:true}).click();
  await page.goBack();
  assert.equal(page.url(),installedURL);
  await (await guest()).getByRole('button',{name:'Installed record',exact:true}).waitFor();
  await page.reload();
  await (await guest()).getByRole('button',{name:'Installed record',exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'local-apps-browser.png'),fullPage:true});
  console.log('PASS: browser preview, activation, data isolation, callbacks, polling input, Back and refresh');
} finally {
  await browser.close();
}
}
void main().catch(error=>{console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g,"[private fixture token]") : "Fixture failed");process.exitCode=1;});
