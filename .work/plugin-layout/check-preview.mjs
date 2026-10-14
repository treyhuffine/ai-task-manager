import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless:true });
const errors = [];
try {
  const page = await browser.newPage({ viewport:{ width:780,height:1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('file:///Users/agent/ai-task-manager/.work/plugin-layout/preview.html');
  const frame = page.frameLocator('iframe');
  await frame.locator('#ri-plugin-layout').waitFor();
  await frame.getByRole('tab',{ name:'Skills',exact:true }).click();
  await frame.getByRole('button',{ name:'Build skill',exact:true }).click();
  await frame.getByRole('textbox',{ name:'What should this skill help your agents do?' }).fill('Review code changes');
  await frame.getByRole('button',{ name:'Back',exact:true }).click();
  await frame.getByRole('tab',{ name:'MCP servers',exact:true }).click();
  await frame.getByRole('button',{ name:'Add MCP server',exact:true }).click();
  await frame.getByRole('textbox',{ name:'Server URL',exact:true }).fill('https://example.com/mcp');
  await frame.getByRole('button',{ name:'Back',exact:true }).click();
  await page.screenshot({ path:'/Users/agent/ai-task-manager/.work/plugin-layout/desktop.png',fullPage:true });
  for (const width of [736,320]) {
    await page.setViewportSize({ width,height:1000 });
    const overflow = await frame.locator('#ri-plugin-layout').evaluate(root => {
      const box=root.getBoundingClientRect();
      return Array.from(root.querySelectorAll('button,input,select,textarea')).filter(item => item.getClientRects().length).some(item => { const r=item.getBoundingClientRect();return r.left<box.left-1 || r.right>box.right+1; });
    });
    assert.equal(overflow,false,`Overflow at ${width}`);
    await frame.locator('[data-variant]').evaluateAll(items=>items.forEach(item=>item.hidden=item.getAttribute('data-variant')!=='One library'));
    await frame.locator('[data-design=library]').getByRole('button',{ name:'Add',exact:true }).click();
    await frame.getByRole('button',{ name:'Add an MCP server',exact:false }).click();
    await frame.getByRole('textbox',{ name:'Server URL',exact:true }).fill('https://example.com/mcp');
    await frame.getByRole('button',{ name:'Back',exact:true }).click();
    await frame.locator('[data-variant]').evaluateAll(items=>items.forEach(item=>item.hidden=item.getAttribute('data-variant')!=='Three destinations'));
  }
  await page.screenshot({ path:'/Users/agent/ai-task-manager/.work/plugin-layout/mobile.png',fullPage:true });
  assert.deepEqual(errors,[]);
  console.log('Both layouts and add/manage interactions passed at 736px and 320px');
} finally { await browser.close(); }
