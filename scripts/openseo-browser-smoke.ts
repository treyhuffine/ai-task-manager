/** Check OpenSEO's hosted and self-hosted forms against the dev UI.
 * Run: pnpm exec tsx scripts/openseo-browser-smoke.ts
 * All connector reads and connection attempts are intercepted fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { APP_ROOT_ENV, getConfigPath, getProductionAppRoot, resolveDevAppRoot } from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import { hostedMcpEndpointSetup } from '@/lib/integrations/hosted-endpoint';

async function main() {
  process.env[APP_ROOT_ENV] = resolveDevAppRoot();
  assert(!isWithin(getConfigPath(), getProductionAppRoot()), 'Use the dev Home');
  const config = JSON.parse(await fs.readFile(getConfigPath(), 'utf8'));
  const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync);
  assert(executablePath, 'Chromium is required');
  const definition = getHostedMcpProvider('openseo')!;
  const output = path.resolve('.work/openseo-browser');
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors: string[] = [];
      const attempts: { kind: string; body: Record<string, unknown> }[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript({ content: "localStorage.setItem('ri.client.apiTransport', 'http');" });
      await page.route('**/api/trpc/integrations.*', async route => {
        const procedure = new URL(route.request().url()).pathname.split('/').at(-1)!;
        let data: unknown;
        if (procedure === 'integrations.statusGet') data = { providers: [{ id: 'openseo', displayName: 'OpenSEO', method: 'mcp', configured: true,
          mcp: { requiresAuth: true, authKind: 'oauth', tokenAuth: definition.tokenAuth, endpointConfig: hostedMcpEndpointSetup(definition), accounts: [] } }], redirectUri: '' };
        else if (procedure === 'integrations.connectionsGet') data = { connections: [] };
        else if (procedure === 'integrations.toolkitsGet' || procedure === 'integrations.writePolicyGet') data = { toolkits: [] };
        else if (procedure === 'integrations.mcpServersGet') data = { servers: [] };
        else if (procedure === 'integrations.connectPost' || procedure === 'integrations.connectDirectPost') {
          attempts.push({ kind: procedure, body: route.request().postDataJSON().body });
          // Keep the form open without saving, navigating or sending any real request.
          await route.fulfill({ status: 400, json: { error: { message: 'Intercepted OpenSEO setup', code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } } } });
          return;
        } else {
          throw new Error(`Unexpected connector request: ${procedure}`);
        }
        await route.fulfill({ json: { result: { data } } });
      });
      await page.goto(`http://127.0.0.1:42241/apps?settings=integrations#token=${encodeURIComponent(config.localToken)}`);
      await page.getByRole('button', { name: /OpenSEO/ }).first().click({ timeout: 120_000 });
      const deployment = page.getByRole('combobox', { name: 'Deployment', exact: true });
      await deployment.waitFor();
      assert.equal(await deployment.inputValue(), 'hosted');
      await page.getByLabel('Account label', { exact: true }).fill('Research');
      await page.getByRole('button', { name: 'Use API key', exact: true }).click();
      const key = page.getByLabel('OpenSEO API key', { exact: true });
      await key.fill('oseo_fixture_key');
      await deployment.selectOption('selfhosted');
      assert.equal(await page.getByRole('button', { name: 'Use API key', exact: true }).count(), 0);
      const auth = page.getByRole('combobox', { name: 'Authentication', exact: true });
      await page.getByLabel('Instance URL', { exact: true }).fill('http://localhost:3000');
      await auth.selectOption('none');
      await page.getByRole('button', { name: 'Connect OpenSEO', exact: true }).click();
      await page.getByText('Intercepted OpenSEO setup', { exact: true }).waitFor();
      assert.equal(attempts.length, 1);
      assert.deepEqual({ endpointId: attempts[0].body.endpointId, instanceUrl: attempts[0].body.instanceUrl, authMethod: attempts[0].body.authMethod, fields: attempts[0].body.fields },
        { endpointId: 'selfhosted', instanceUrl: 'http://localhost:3000', authMethod: 'none', fields: {} });
      assert.equal(attempts[0].kind, 'integrations.connectDirectPost');
      await page.screenshot({ path: path.join(output, `docker-${width}.png`), fullPage: true });
      await page.getByLabel('Instance URL', { exact: true }).fill('https://seo.example');
      await auth.selectOption('oauth');
      await page.getByText(/Enable Managed OAuth/).waitFor();
      await page.getByRole('button', { name: 'Connect OpenSEO', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes('Intercepted OpenSEO setup'));
      await page.waitForTimeout(100);
      assert.equal(attempts.length, 2);
      assert.equal(attempts[1].kind, 'integrations.connectPost');
      assert.equal(attempts[1].body.authMethod, 'oauth');
      assert.equal(attempts[1].body.instanceUrl, 'https://seo.example');
      await deployment.selectOption('hosted');
      await page.getByRole('button', { name: 'Use API key', exact: true }).click();
      assert.equal(await key.inputValue(), '');
      assert.equal(await page.getByLabel('Instance URL', { exact: true }).count(), 0);
      const overflow = await page.getByRole('dialog').evaluate(element => element.scrollWidth > element.clientWidth + 1);
      assert.equal(overflow, false, `Settings overflow at ${width}px`);
      assert.deepEqual(errors, [], `Browser errors at ${width}px`);
      await context.close();
      console.log(`OpenSEO deployment forms passed at ${width}px`);
    }
  } finally { await browser.close(); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message.replace(/(?:#token=|ri_live_)[^\s"']+/g, '[dev token]') : 'OpenSEO browser check failed');
  process.exitCode = 1;
});
