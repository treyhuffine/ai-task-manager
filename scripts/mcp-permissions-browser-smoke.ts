/** Exercise MCP settings against the dev UI with disposable intercepted data.
 * Run: pnpm exec tsx scripts/mcp-permissions-browser-smoke.ts
 * No connector request or preference write reaches a real account or Home.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { APP_ROOT_ENV, getConfigPath, getProductionAppRoot, resolveDevAppRoot } from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import { clearMcpToolApprovals, DEFAULT_MCP_APPROVAL_POLICY, patchMcpToolOverrides, type McpApprovalPolicy, type McpToolApprovalPatch } from '@/lib/integrations/mcp-approval-policy';
import type { McpServerEntry } from '@/components/settings/sections/integrations/types';

async function checked(page: Page, label: string, value: boolean) {
  await page.getByRole('switch', { name: label, exact: true }).waitFor();
  await page.waitForFunction(({ label, value }) => document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-checked') === String(value), { label, value });
}

async function choose(page: Page, name: string, choice: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: choice, exact: true }).click();
}

async function main() {
  process.env[APP_ROOT_ENV] = resolveDevAppRoot();
  assert(!isWithin(getConfigPath(), getProductionAppRoot()), 'Use the dev Home');
  const config = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
  const base = 'http://127.0.0.1:42241';
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Chromium is required');
  const output = path.resolve('.work/mcp-permissions');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      let override: McpApprovalPolicy | null = null;
      let failNextSave = false;
      const server: McpServerEntry = { id: 'smoke-mcp', slug: 'permission_smoke', displayName: 'Permission smoke', url: 'https://example.com/mcp', enabled: true,
        auth: { kind: 'none' }, lastStatus: 'ok', tools: [{ name: 'read_records', readOnlyHint: true }, { name: 'write_record' }, { name: 'disabled_tool' }],
        toolOverrides: { disabled_tool: { enabled: false } }, capabilityChanges: { revision: 'new-tools', added: ['write_record'], removed: [], changed: [] } };
      const settings = () => ({ defaultPolicy: override ?? DEFAULT_MCP_APPROVAL_POLICY, override });
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript({ content: "localStorage.setItem('ri.client.apiTransport', 'http');" });
      await page.route('**/api/trpc/integrations.*', async route => {
        const procedure = new URL(route.request().url()).pathname.split('/').at(-1)!;
        let data: unknown;
        if (procedure === 'integrations.statusGet') data = { providers: [], redirectUri: '' };
        else if (procedure === 'integrations.connectionsGet') data = { connections: [] };
        else if (procedure === 'integrations.toolkitsGet' || procedure === 'integrations.writePolicyGet') data = { toolkits: [] };
        else if (procedure === 'integrations.mcpServersGet') data = { servers: [server], approvalSettings: settings() };
        else if (procedure === 'integrations.mcpApprovalPolicyPatch') {
          const input = route.request().postDataJSON() as { body: { defaultPolicy: McpApprovalPolicy | null; applyToAll?: boolean } };
          override = input.body.defaultPolicy;
          if (input.body.applyToAll) { delete server.approvalPolicy; server.toolOverrides = clearMcpToolApprovals(server.toolOverrides); }
          data = { servers: [server], approvalSettings: settings() };
        } else if (procedure === 'integrations.mcpServersPatch') {
          if (failNextSave) {
            failNextSave = false;
            await route.fulfill({ status: 500, json: { error: { message: 'Permission save failed', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } });
            return;
          }
          const { body } = route.request().postDataJSON() as { body: { approvalPolicy?: McpApprovalPolicy | null; resetToolApprovals?: boolean; toolOverrides?: Record<string, McpToolApprovalPatch> } };
          if (body.approvalPolicy === null) delete server.approvalPolicy;
          else if (body.approvalPolicy !== undefined) server.approvalPolicy = body.approvalPolicy;
          if (body.toolOverrides) server.toolOverrides = patchMcpToolOverrides(server.toolOverrides, body.toolOverrides);
          if (body.resetToolApprovals) server.toolOverrides = clearMcpToolApprovals(server.toolOverrides);
          if ('reviewedRevision' in body) delete server.capabilityChanges;
          data = { entry: server };
        } else { await route.continue(); return; }
        await route.fulfill({ json: { result: { data } } });
      });
      await page.goto(`${base}/apps?settings=plugins&plugin=mcp#token=${encodeURIComponent(config.localToken)}`, { timeout: 120_000 });
      await page.getByRole('combobox', { name: 'Default MCP permissions' }).waitFor({ timeout: 120_000 });
      const global = page.getByRole('region', { name: 'Global MCP permissions', exact: true });
      assert((await global.boundingBox())!.y < (await page.getByRole('textbox', { name: 'Search MCP servers' }).boundingBox())!.y, 'Global defaults precede server search');
      const arrowInset = await global.getByRole('combobox').evaluate(element => element.getBoundingClientRect().right - element.querySelector('svg')!.getBoundingClientRect().right);
      assert(arrowInset >= 10, 'Dropdown chevron has right padding');
      await page.screenshot({ path: path.join(output, `global-layout-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: /^Permission smoke/ }).click();
      await page.getByText('Tools changed', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Dismiss notice', exact: true }).click();
      await page.getByText('Tools changed', { exact: true }).waitFor({ state: 'hidden' });
      await checked(page, 'Ask before read_records runs', false);
      await checked(page, 'Ask before write_record runs', true);
      await checked(page, 'Enable disabled_tool', false);
      const policy = page.getByRole('combobox', { name: 'Permissions for Permission smoke' });
      await policy.click();
      await page.keyboard.press('Escape');
      await policy.waitFor();
      assert.equal(await policy.getAttribute('aria-expanded'), 'false', 'Escape closes the dropdown before leaving the server');
      await choose(page, 'Permissions for Permission smoke', 'Always allow');
      await checked(page, 'Ask before write_record runs', false);
      await checked(page, 'Enable disabled_tool', false);
      await page.getByRole('switch', { name: 'Ask before write_record runs', exact: true }).click();
      await checked(page, 'Ask before write_record runs', true);
      await page.getByRole('button', { name: 'Apply to all tools', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `server-layout-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: 'Apply to all tools', exact: true }).click();
      await checked(page, 'Ask before write_record runs', false);
      await checked(page, 'Enable disabled_tool', false);
      await page.getByRole('switch', { name: 'Ask before write_record runs', exact: true }).click();
      await checked(page, 'Ask before write_record runs', true);
      await page.getByRole('button', { name: 'Use server permissions for write_record', exact: true }).click();
      await checked(page, 'Ask before write_record runs', false);
      await choose(page, 'Permissions for Permission smoke', 'Ask every time');
      await checked(page, 'Ask before read_records runs', true);
      await page.screenshot({ path: path.join(output, `server-${width}.png`), fullPage: true });
      failNextSave = true;
      await choose(page, 'Permissions for Permission smoke', 'Always allow');
      await page.getByText('Permission save failed', { exact: true }).waitFor();
      await checked(page, 'Ask before read_records runs', true);
      await page.getByRole('button', { name: 'All MCP servers', exact: true }).click();
      await choose(page, 'Default MCP permissions', 'Always allow');
      const apply = page.getByRole('button', { name: 'Apply to all servers', exact: true });
      await apply.click();
      await page.getByText('Permissions applied to all MCP servers', { exact: true }).waitFor();
      assert.equal(server.approvalPolicy, undefined);
      assert.deepEqual(server.toolOverrides, { disabled_tool: { enabled: false } });
      await page.screenshot({ path: path.join(output, `global-${width}.png`), fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: /^Permission smoke/ }).click();
      await checked(page, 'Ask before read_records runs', false);
      await checked(page, 'Ask before write_record runs', false);
      await checked(page, 'Enable disabled_tool', false);
      const overflow = await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1);
      assert.equal(overflow, false, `Settings overflow at ${width}px`);
      assert.deepEqual(errors, [], `Browser errors at ${width}px`);
      await context.close();
      console.log(`MCP permissions passed at ${width}px`);
    }
  } finally { await browser.close(); }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[dev token]') : 'MCP permissions browser check failed');
  process.exitCode = 1;
});
