import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { APP_ROOT_ENV, getConfigPath, resolveDevAppRoot } from '@/lib/config/paths';

async function main() {
  process.env[APP_ROOT_ENV] = resolveDevAppRoot();
  const config = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath);
  const output = path.resolve('.work/mcp-permissions-preview');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.addInitScript({ content: "localStorage.setItem('ri.client.apiTransport', 'http');" });
      await page.route('**/api/trpc/integrations.*', async route => {
        const procedure = new URL(route.request().url()).pathname.split('/').at(-1)!;
        if (route.request().method() !== 'GET') { await route.abort(); return; }
        const data = procedure === 'integrations.mcpServersGet' ? {
          approvalSettings: { defaultPolicy: 'writes', override: null },
          servers: [{ id: 'preview', slug: 'preview', displayName: 'Google Drive MCP', url: 'https://example.com/mcp', enabled: true, auth: { kind: 'none' }, lastStatus: 'ok', approvalPolicy: 'auto',
            tools: [{ name: 'search_files', description: 'Find files by name or content', readOnlyHint: true }, { name: 'create_file', description: 'Create a new file' }, { name: 'delete_file', description: 'Delete a file' }],
            toolOverrides: { create_file: { approvalMode: 'ask' }, delete_file: { enabled: false } } }],
        } : procedure === 'integrations.statusGet' ? { providers: [], redirectUri: '' }
          : procedure === 'integrations.connectionsGet' ? { connections: [] } : { toolkits: [] };
        await route.fulfill({ json: { result: { data } } });
      });
      await page.goto(`http://127.0.0.1:42241/apps?settings=plugins&plugin=mcp#token=${encodeURIComponent(config.localToken)}`, { timeout: 120_000 });
      const global = page.getByRole('region', { name: 'Global MCP permissions', exact: true });
      await global.waitFor();
      await global.locator(':scope > p').evaluate(element => {
        element.textContent = 'App default: Ask before writes. Changes save immediately. Apply to all servers replaces individual approval settings with this default. Disabled tools stay off.';
      });
      const content = page.locator('[data-settings-scroll]').locator('..');
      await content.screenshot({ path: path.join(output, `global-${width}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: /^Google Drive MCP/ }).click();
      const server = page.getByRole('region', { name: 'Server permissions for Google Drive MCP', exact: true });
      await server.waitFor();
      await server.locator(':scope > p').evaluate(element => {
        element.textContent = 'Changes save immediately. Apply to all tools resets individual approval choices to this setting. Disabled tools stay off.';
      });
      await page.locator('[data-settings-scroll]').evaluate(element => { element.scrollTop = 0; });
      await content.screenshot({ path: path.join(output, `server-${width}.png`), animations: 'disabled' });
      await context.close();
      console.log(`Captured proposed copy at ${width}px`);
    }
  } finally { await browser.close(); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[dev token]') : 'Screenshot capture failed');
  process.exitCode = 1;
});
