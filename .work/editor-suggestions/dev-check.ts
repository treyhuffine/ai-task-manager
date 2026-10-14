import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import type { Editor } from '@tiptap/core';
import type { Note } from '@/db/types';
import { APP_ROOT_ENV, resolveDevAppRoot, getConfigPath } from '@/lib/config/paths';

async function menuNearTrigger(page: Page, label: string) {
 await page.waitForFunction(() => {
  const popup=document.querySelector('.slash-command-popup'), anchor=document.querySelector('[data-decoration-id]');
  if(!popup||!anchor||!popup.firstElementChild)return false;
  const p=popup.getBoundingClientRect(),a=anchor.getBoundingClientRect();
  return Math.min(Math.abs(p.top-a.bottom),Math.abs(a.top-p.bottom))<10 && p.left>=0 && p.right<=innerWidth;
 },{},{timeout:10000});
 console.log('PASS',label);
}
async function main(){
 process.env[APP_ROOT_ENV]=resolveDevAppRoot();
 const config=JSON.parse(await fs.readFile(getConfigPath(),'utf8'));
 const browser=await chromium.launch({executablePath:'/Users/agent/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.setDefaultTimeout(20000);
 await page.addInitScript({content:"window.__name=fn=>fn; localStorage.setItem('ri.client.apiTransport','http');"});
 let note:Note|null=null;
 await page.route('**/api/trpc/notes.get*',async route=>{const response=await route.fetch();note=(await response.json()).result.data;await route.fulfill({response});});
 await page.route('**/api/trpc/notes.update',async route=>{const {patch}=route.request().postDataJSON();await route.fulfill({json:{result:{data:{...note,...patch}}}});});
 await page.goto(`http://127.0.0.1:42241/note/01a1122d-d562-7558-8ae8-41a0cb56a019#token=${encodeURIComponent(config.localToken)}`);
 const editor=page.locator('.rich-editor .ProseMirror');
 await editor.waitFor({timeout:120000});
 await editor.evaluate(element=>{const editor=(element as HTMLElement&{editor:Editor}).editor;editor.commands.focus('start');editor.commands.insertContent('@coffee ');});
 await menuNearTrigger(page,'mobile note @');
 await page.screenshot({path:'.work/editor-suggestions/dev-mobile-note-mention.png'});
 await page.keyboard.press('Escape');
 await editor.evaluate(element=>{const editor=(element as HTMLElement&{editor:Editor}).editor;editor.commands.setContent('<p>/</p>');editor.commands.focus('end');});
 await menuNearTrigger(page,'mobile note slash');
 await page.screenshot({path:'.work/editor-suggestions/dev-mobile-note-slash.png'});
 await page.goto('http://127.0.0.1:42241/?agent=01a1122d-d51f-79c8-809c-92b13d0962e7');
 await page.waitForTimeout(2000);
 console.log('Root text',(await page.locator('body').innerText()).slice(0,1800));
 console.log('Buttons',await page.getByRole('button').allTextContents());
 await page.getByRole('button',{name:'New chat',exact:true}).first().click();
 const composer=page.getByRole('dialog').locator('.ProseMirror');
 await composer.waitFor();
 await composer.fill('@');
 await menuNearTrigger(page,'mobile New chat @');
 await page.screenshot({path:'.work/editor-suggestions/dev-mobile-new-chat.png'});
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('dialog').count(),1);
 await composer.fill('');
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('dialog').count(),0);
 await page.goto('http://127.0.0.1:42241/?session=01a1122d-d616-7ee3-9980-8a39e125c6ea');
 const chatEditor=page.locator('.ProseMirror:visible').last();
 await chatEditor.waitFor({timeout:120000});
 await chatEditor.fill('@task:coffee');
 await page.screenshot({path:'.work/editor-suggestions/dev-existing-debug.png'});
 console.log('Existing editor',await chatEditor.evaluate(element=>({class:element.className,text:element.textContent,parent:element.parentElement?.outerHTML.slice(0,500)})));
 console.log('Menus',await page.locator('.slash-command-popup').count());
 await menuNearTrigger(page,'existing chat @');
 await page.screenshot({path:'.work/editor-suggestions/dev-mobile-existing-chat.png'});
 await chatEditor.fill('');
 await page.goto('http://127.0.0.1:42241/');
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('open-search')));
 const search=page.getByPlaceholder('Search or type > for commands...');
 await search.fill('Green coffee buying');
 await page.getByText('Green coffee buying notes: 2026 harvest',{exact:true}).first().click();
 const slideout=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Note',exact:true})});
 const slideoutEditor=slideout.locator('.rich-editor .ProseMirror');
 await slideoutEditor.waitFor();
 await slideoutEditor.evaluate(element=>{const editor=(element as HTMLElement&{editor:Editor}).editor;editor.commands.focus('start');editor.commands.insertContent('@coffee ');});
 await menuNearTrigger(page,'mobile note slideout @');
 await page.screenshot({path:'.work/editor-suggestions/dev-mobile-note-slideout.png'});
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
