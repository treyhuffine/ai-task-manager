import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { APP_ROOT_ENV, resolveDevAppRoot, getConfigPath } from '@/lib/config/paths';
async function main() {
process.env[APP_ROOT_ENV] = resolveDevAppRoot();
const config = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
const browser = await chromium.launch({executablePath: '/Users/agent/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', headless: true});
try {
 const page = await browser.newPage({ viewport: {width:1440,height:900}});
 await page.addInitScript({content: "window.__name=fn=>fn; localStorage.setItem('ri.client.apiTransport','http');"});
 await page.goto(`http://127.0.0.1:42241/note/01a1122d-d562-7558-8ae8-41a0cb56a019#token=${encodeURIComponent(config.localToken)}`);
 await page.locator('body').waitFor();
 await page.waitForTimeout(3000);
 console.log((await page.locator('body').innerText()).slice(0,6000));
 await page.screenshot({path:'.work/editor-suggestions/dev-page.png'});
 console.log(await page.getByRole('button').allTextContents());
 
 await page.locator('.rich-editor .ProseMirror').waitFor();
 console.log('note URL',page.url().split('#')[0]);
 await page.screenshot({path:'.work/editor-suggestions/dev-note-before.png'});
} finally {await browser.close();}

}
void main().catch(error => { console.error(error); process.exitCode=1; });
