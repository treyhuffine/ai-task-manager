/** Qualify Plugins navigation and creation with intercepted disposable data.
 * Run against pnpm dev: pnpm exec tsx scripts/plugins-browser-smoke.ts
 * Account, MCP, skill, and builder requests never write to the dev or real Home.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { APP_ROOT_ENV, getConfigPath, getProductionAppRoot, resolveDevAppRoot } from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import type { McpServerEntry, ProviderStatus } from '@/components/settings/sections/integrations/types';
import type { SkillView } from '@/lib/api/skills';

const providers: ProviderStatus[] = [
  { id: 'github', displayName: 'GitHub', method: 'api_key', configured: true, credentialFields: ['token'] },
  ...Array.from({ length: 36 }, (_, index): ProviderStatus => ({ id: `smoke-${index}`, displayName: `Service ${index}`, method: 'api_key', configured: true, credentialFields: ['token'] })),
];
const draft: SkillView = { ref: 'draft:smoke-skill', name: 'smoke-skill', description: null, location: { kind: 'draft' }, updatedAt: new Date().toISOString(),
  editable: true, linkedFrom: null, hasErrors: false, uncommitted: false, dir: '/disposable/skill-drafts/smoke-skill', content: '', hash: 'smoke', body: '',
  otherKeys: [], frontmatterError: null, problems: [], files: [], git: null, canWriteGlobal: false };

async function creationVisible(page: Page, width: number) {
  const toolbar = page.locator('[data-plugin-actions]');
  for (const label of ['Connect a service', 'New skill', 'Add MCP server']) {
    const button = toolbar.getByRole('button', { name: label, exact: true });
    await button.waitFor();
    const bounds = await button.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y > 0, `${label} fits at ${width}px`);
  }
  assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1), false, `Settings fits at ${width}px`);
  assert.equal(await page.getByRole('dialog').evaluate(element => element.scrollTop), 0, 'Only the content pane scrolls, keeping settings navigation and close visible');
}

async function focused(page: Page, id: string) {
  await page.waitForFunction(id => document.activeElement?.id === id, id);
}

async function main() {
  process.env[APP_ROOT_ENV] = resolveDevAppRoot();
  assert(!isWithin(getConfigPath(), getProductionAppRoot()), 'Use the dev Home');
  const config = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Chromium is required');
  const output = path.resolve('.work/plugins-layout');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      const unexpectedWrites: string[] = [];
      const reads: string[] = [];
      let skillCreates = 0;
      let failSkill = false;
      let failMcp = false;
      let blockCatalog = false;
      let releaseCatalog: (() => void) | undefined;
      let catalogGate = Promise.resolve();
      const servers: McpServerEntry[] = [];
      const settings = { defaultPolicy: 'writes', override: null };
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript({ content: "localStorage.setItem('ri.client.apiTransport', 'http');" });
      await page.route('**/api/trpc/**', async route => {
        const procedure = new URL(route.request().url()).pathname.split('/').at(-1)!;
        let data: unknown;
        const fail = async (message: string) => route.fulfill({ status: 500, json: { error: { message, code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } });
        if (route.request().method() === 'GET') reads.push(procedure);
        if (procedure === 'integrations.statusGet') { if (blockCatalog) await catalogGate; data = { providers, redirectUri: '' }; }
        else if (procedure === 'integrations.connectionsGet') data = { connections: [] };
        else if (procedure === 'integrations.toolkitsGet' || procedure === 'integrations.writePolicyGet') data = { toolkits: [] };
        else if (procedure === 'integrations.requestSettingsGet') data = { requestsEnabled: true };
        else if (procedure === 'integrations.mcpServersGet') data = { servers, approvalSettings: settings };
        else if (procedure === 'integrations.mcpServersPost') {
          if (failMcp) { failMcp = false; await fail('MCP connection failed'); return; }
          const { body } = route.request().postDataJSON();
          assert.deepEqual(body.auth, { kind: 'header', header: 'X-API-Key' });
          assert.equal(body.secret, 'disposable-smoke-token');
          const entry: McpServerEntry = { id: 'smoke-server', slug: 'smoke', displayName: body.name, url: body.url, auth: body.auth, enabled: true, lastStatus: 'ok', tools: [{ name: 'read_records', readOnlyHint: true }] };
          servers.push(entry); data = { entry };
        } else if (procedure === 'skills.list') data = { skills: [draft], projects: [], canWriteGlobal: false };
        else if (procedure === 'skills.create') {
          assert.deepEqual(route.request().postDataJSON(), { body: {} });
          skillCreates++;
          if (failSkill) { failSkill = false; await fail('Skill creation failed'); return; }
          data = { skill: draft };
        } else if (procedure === 'skills.RefGet') data = { skill: draft };
        else if (procedure === 'documentChat.list') data = { session: null };
        else if (procedure === 'pluginEvaluation.status') data = { available: false };
        else if (procedure === 'pluginEvaluation.accounts') data = [];
        else if (procedure.startsWith('integrations.') || procedure.startsWith('skills.') || procedure.startsWith('documentChat.') || procedure.startsWith('pluginEvaluation.')) {
          unexpectedWrites.push(procedure); await fail('Unmocked setup operation'); return;
        } else { await route.continue(); return; }
        await route.fulfill({ json: { result: { data } } });
      });
      const visit = (anchor: string, result = '') => page.goto(`http://127.0.0.1:42241/apps?settings=plugins&plugin=${encodeURIComponent(anchor)}${result}#token=${encodeURIComponent(config.localToken)}`);
      const tab = (name: string) => page.getByRole('tab', { name, exact: true });
      const action = (name: string) => page.locator('[data-plugin-actions]').getByRole('button', { name, exact: true });

      // A direct add link mounts neither the service catalog nor examples.
      await visit('mcp:new');
      await page.getByLabel('Name', { exact: true }).waitFor({ timeout: 120_000 });
      await focused(page, 'mcp-name');
      assert.equal(await tab('MCP servers').getAttribute('aria-selected'), 'true');
      assert(!reads.includes('integrations.statusGet'), 'MCP setup does not load the service catalog');
      assert(!reads.some(read => read.startsWith('pluginEvaluation.')), 'Examples are opt-in');
      await creationVisible(page, width);
      await page.getByLabel('Name', { exact: true }).fill('My custom tools');
      await page.getByLabel('Server URL').fill('https://example.com/mcp');
      await page.getByLabel('Auth', { exact: true }).selectOption('header');
      await page.getByLabel('Header name').fill('X-API-Key');
      await page.getByLabel('Secret', { exact: true }).fill('disposable-smoke-token');
      await tab('Skills').click();
      await page.getByRole('button', { name: /^smoke-skill/ }).waitFor();
      await creationVisible(page, width);
      await action('Add MCP server').click();
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'My custom tools', 'Unfinished form survives tab changes');
      assert.equal(await page.getByLabel('Secret', { exact: true }).inputValue(), 'disposable-smoke-token');
      await focused(page, 'mcp-name');
      failMcp = true;
      await page.getByRole('button', { name: 'Add and connect', exact: true }).click();
      await page.getByText('MCP connection failed', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'My custom tools', 'Failed connect retains input');
      await page.getByRole('button', { name: 'Add and connect', exact: true }).click();
      await page.getByRole('combobox', { name: 'Permissions for My custom tools' }).waitFor();
      assert(new URL(page.url()).searchParams.get('plugin') === 'mcp:smoke-server');
      await page.getByRole('button', { name: 'All MCP servers', exact: true }).click();
      await page.getByRole('button', { name: /^My custom tools/ }).waitFor();
      await creationVisible(page, width);
      await page.screenshot({ path: path.join(output, `mcp-${width}.png`), fullPage: true, animations: "disabled" });
      await visit('mcp:smoke-server', '&connected=My%20custom%20tools');
      await page.getByText('Connected My custom tools', { exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Permissions for My custom tools' }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('connected'), null, 'Sign-in result is consumed');

      // Connect always returns to the catalog and focuses search, even from a detail.
      await action('Connect a service').click();
      const search = page.getByRole('textbox', { name: 'Search connectors', exact: true });
      await search.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search connectors');
      await creationVisible(page, width);
      await page.screenshot({ path: path.join(output, `connectors-${width}.png`), fullPage: true, animations: "disabled" });
      await page.locator('[data-settings-scroll]').evaluate(element => { element.scrollTop = 1000; });
      await creationVisible(page, width);
      const stuck = await page.locator('[data-plugin-actions]').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const pane = element.closest('[data-settings-scroll]')!;
        const viewport = pane.getBoundingClientRect();
        const points = [bounds.left + 1, (bounds.left + bounds.right) / 2, bounds.right - 1];
        return {
          topGap: bounds.top - viewport.top,
          leftGap: bounds.left - viewport.left,
          rightGap: viewport.left + pane.clientWidth - bounds.right,
          covered: points.every(x => element.contains(document.elementFromPoint(x, viewport.top + 2))),
        };
      });
      assert(Math.abs(stuck.topGap) <= 1, 'Sticky header meets the top of the scrolling pane');
      assert(Math.abs(stuck.leftGap) <= 1 && Math.abs(stuck.rightGap) <= 1, 'Sticky background spans the scrolling pane');
      assert(stuck.covered, 'The sticky background covers underlying content, including its edges');
      await page.screenshot({ path: path.join(output, `scrolled-${width}.png`), fullPage: true, animations: 'disabled' });
      await action('Connect a service').click();
      await search.fill('GitHub');
      await page.getByRole('button', { name: /^GitHub/ }).click();
      await page.getByRole('button', { name: 'All connectors', exact: true }).waitFor();
      await action('Connect a service').click();
      assert.equal(await search.inputValue(), '');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search connectors');
      await tab('Skills').click();
      await page.screenshot({ path: path.join(output, `skills-${width}.png`), fullPage: true, animations: "disabled" });
      failSkill = true;
      await action('New skill').click();
      await page.getByText('Skill creation failed', { exact: true }).waitFor();
      await action('New skill').click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get('skill') === 'draft:smoke-skill');
      await page.getByRole('tab', { name: 'Build', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0, 'Creation goes straight to the builder');
      assert.equal(skillCreates, 2);

      // The main Create menu bypasses Settings navigation on desktop and mobile.
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByRole('button', { name: 'Add MCP server', exact: true }).click();
      await page.getByLabel('Name', { exact: true }).waitFor();
      await focused(page, 'mcp-name');
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByRole('button', { name: 'New skill', exact: true }).click();
      await page.getByRole('tab', { name: 'Build', exact: true }).waitFor();
      assert.equal(skillCreates, 3);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByRole('button', { name: 'Connect a service', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search connectors', exact: true }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

      // Search has the same direct destinations, including on phones.
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('open-search', { detail: { initialQuery: '> Add MCP' } })));
      await page.getByRole('option', { name: /Add MCP server/ }).click();
      await page.getByLabel('Name', { exact: true }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

      // A stalled service catalog cannot block the Add MCP entry.
      blockCatalog = true;
      catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
      await visit('integrations');
      await action('Add MCP server').waitFor();
      await action('Add MCP server').click();
      await page.getByLabel('Name', { exact: true }).waitFor({ timeout: 2000 });
      releaseCatalog!(); blockCatalog = false;
      await page.getByRole('button', { name: 'All MCP servers', exact: true }).click();
      await page.getByRole('button', { name: 'Interactive examples', exact: true }).click();
      await page.getByRole('table', { name: 'Interactive plugin demos' }).waitFor();
      await page.getByRole('button', { name: 'Interactive examples', exact: true }).click();
      assert.equal(await page.getByRole('table', { name: 'Interactive plugin demos' }).count(), 0);
      assert.deepEqual(unexpectedWrites, []);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Plugins creation and navigation passed at ${width}px`);
    }
  } finally { await browser.close(); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[dev token]') : 'Plugins browser check failed');
  process.exitCode = 1;
});
