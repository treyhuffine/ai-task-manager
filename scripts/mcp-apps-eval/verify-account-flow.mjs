// Controlled protocol/UI fixtures. This does not qualify an authenticated provider.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, serverEnv } from './config.mjs'

const testOrigin = process.env.RI_MCP_APPS_TEST_HOME_ORIGIN
if (!testOrigin || !['localhost', '127.0.0.1'].includes(new URL(testOrigin).hostname) || !process.env.RI_ROOT?.startsWith('/private/tmp/')) throw new Error('An isolated synthetic Ri Home is required')
const config = JSON.parse(readFileSync(join(root, 'remote.json'), 'utf8'))
const require = createRequire(import.meta.url)
const token = require('../../src/lib/auth/config-file.ts').readAuthConfig()?.localToken
if (!token) throw new Error('The synthetic Ri Home has no viewer credential')
const { chromium } = createRequire(join(root, 'host/package.json'))('playwright-core')
const executablePath = process.env.RI_MCP_APPS_BROWSER || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, env: serverEnv() })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const chatTicket = randomUUID(); let chatSource;
const handle = randomUUID(), checks = [], methods = [], widgetRequests = [], executions = []
let approved = false, ended = false, closing = false
const ledger = new Map()
const resourceUri = 'ui://synthetic-query'
const tools = [
  { name: 'query', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, _meta: { ui: { resourceUri, visibility: ['model'] } } },
  { name: 'filter', inputSchema: { type: 'object', properties: {} }, _meta: { ui: { visibility: ['app'] } } },
]
const html = `<!doctype html><html><body><h2>Controlled account widget</h2><p id="value">Waiting</p><button id="filter">Filter sample</button><script>
let id=1;const send=(method,params)=>parent.postMessage({jsonrpc:'2.0',id:id++,method,params},'*');
send('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Fixture',version:'1'},appCapabilities:{}});
addEventListener('message',event=>{if(event.source!==parent)return;const rpc=event.data;if(rpc.id===1&&rpc.result)parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');if(rpc.method==='ui/notifications/tool-result')document.querySelector('#value').textContent=rpc.params.structuredContent.label;if(rpc.result?.structuredContent?.label)document.querySelector('#value').textContent=rpc.result.structuredContent.label;});
document.querySelector('#filter').onclick=()=>send('tools/call',{name:'filter',arguments:{}});
</script></body></html>`
function pass(value) { checks.push(value); console.log('PASS ' + value) }
async function until(check) { const limit = Date.now() + 20000; while (Date.now() < limit) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('Fixture state did not settle') }
function rpc(input) {
  methods.push(input.method)
  if (ended) throw new Error('The controlled session ended')
  if (input.method === 'initialize') return { result: { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'posthog · Synthetic analytics', version: 'fixture' } } }
  if (input.method === 'tools/list') return { result: { tools } }
  if (input.method === 'resources/list') return { result: { resources: [{ uri: resourceUri, name: 'Sample query', mimeType: 'text/html;profile=mcp-app' }] } }
  if (input.method === 'resources/read') return { result: { contents: [{ uri: resourceUri, mimeType: 'text/html;profile=mcp-app', text: html }] } }
  if (input.method !== 'tools/call') throw new Error('Unsupported fixture operation')
  assert.equal(input.handle, handle)
  widgetRequests.push(input)
  if (ledger.has(input.invocationId)) return ledger.get(input.invocationId)
  if (input.name === 'query' && !approved) return { result: { isError: true, content: [{ type: 'text', text: 'Approval needed' }] }, approvalIds: ['controlled-approval'] }
  executions.push(input.name)
  const reply = { result: { content: [{ type: 'text', text: 'Sample query returned 42' }], structuredContent: { label: input.name === 'filter' ? 'Filtered sample: 42' : 'Sample: 42' }, _meta: { privateUi: 'PRIVATE_WIDGET_PAYLOAD' } } }
  ledger.set(input.invocationId, reply)
  return reply
}
try {
  await context.route(config.parentOrigin + '/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/live') return route.fulfill({ contentType: 'text/event-stream', body: '' })
    try {
      const response = await route.fetch({ url: testOrigin + url.pathname + url.search, timeout: 120000 })
      await route.fulfill({ response })
    } catch { if (!closing) await route.fulfill({ status: 503, body: 'The synthetic Home is unavailable' }).catch(() => {}) }
  })
  await context.route(config.parentOrigin + '/api/trpc/**', async route => {
    const url = new URL(route.request().url()), names = url.pathname.slice('/api/trpc/'.length).split(',')
    const owned = name => name.startsWith('pluginEvaluation.') && name !== 'pluginEvaluation.status' || name === 'integrations.approvePost'
    if (!names.some(owned)) return route.fallback()
    const inputs = route.request().postData() ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') || '{}')
    const originals = names.some(name => !owned(name)) ? await (await route.fetch({ url: testOrigin + url.pathname + url.search })).json() : []
    const replies = await Promise.all(names.map(async (name, index) => {
      if (!owned(name)) return originals[index]
      const input = url.searchParams.get('batch') === '1' ? inputs[index] ?? {} : inputs
      let data
      if (name === 'pluginEvaluation.accounts') data = ['one', 'two'].map(id => ({ providerId: 'posthog', serverId: id, label: `Synthetic analytics ${id}`, available: true, interactiveTools: 1, status: 'Interactive views discovered' }))
      else if (name === 'pluginEvaluation.launchAccount') {
        assert.equal(input.serverId, 'two')
        const minted = await (await fetch('http://127.0.0.1:48885/__launch', { method: 'POST', headers: { 'x-ri-evaluation-key': config.key } })).json()
        data = { url: config.hostOrigin + '/s/' + minted.token + '/index.html?account=' + handle, handle, account: 'Synthetic analytics two', providerId: 'posthog', expiresAt: minted.expiresAt }
      } else if (name === 'pluginEvaluation.accountRpc') data = rpc(input)
      else if (name === 'pluginEvaluation.chat') {
        assert.equal(input.allowChanges, true); assert.equal(input.context.app, 'PostHog'); assert.equal(input.context.operation.toolName, 'query');
        assert(!input.context.text.includes('PRIVATE_WIDGET_PAYLOAD'));
        chatSource = input.context.invocationId;
        data = { text: 'Controlled account chat proposal. Review this query.', turnId: input.turnId, context: input.context, tool: { status: 'approval', ticket: chatTicket, toolName: 'query', arguments: { query: 'updated sample' }, approvalIds: ['controlled-chat-approval'] } };
      } else if (name === 'pluginEvaluation.accountChatCapture') {
        assert.equal(input.ticket, chatTicket); assert.equal(input.retryApproval, true);
        executions.push('chat:query');
        data = { kind: 'view', invocationId: chatSource, toolName: 'query', input: { query: 'updated sample' }, result: { content: [{ type: 'text', text: 'Updated sample 84' }], structuredContent: { label: 'Updated sample: 84' }, _meta: { privateUi: 'PRIVATE_WIDGET_PAYLOAD' } } };
      }
      else if (name === 'integrations.approvePost') { approved = input.body.decision === 'approve'; data = { ok: true } }
      else if (name === 'pluginEvaluation.endAccount') { ended = true; data = { ok: true } }
      else throw new Error('Unexpected fixture request')
      return { result: { data } }
    }))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? replies : replies[0]) })
  })
  await context.addInitScript(origin => { if (location.origin === origin) localStorage.setItem('ri.client.apiTransport', 'http') }, config.parentOrigin)
  await page.goto(config.parentOrigin + '/?settings=plugins#token=' + encodeURIComponent(token))
  const table = page.getByRole('table', { name: 'Interactive plugin demos' })
  await table.locator('tbody tr').first().waitFor()
  assert.equal(await table.locator('tbody tr').count(), 7)
  const posthog = table.getByRole('row').filter({ has: page.getByRole('link', { name: 'PostHog', exact: true }) })
  assert.equal(await posthog.getByRole('button', { name: 'Try interactive view' }).isEnabled(), false)
  await posthog.getByRole('combobox').selectOption('two')
  await posthog.getByRole('button', { name: 'Try interactive view' }).click()
  await page.getByText('Selected account: Synthetic analytics two.', { exact: false }).waitFor()
  const host = await (await page.getByTitle('Interactive plugin examples').elementHandle()).contentFrame()
  await host.getByRole('heading', { name: 'posthog · Synthetic analytics' }).waitFor()
  assert.equal(executions.length, 0)
  pass('Seven rows and explicit multi-account selection open the real account bridge without a tool call')
  await host.getByRole('textbox', { name: 'query', exact: true }).fill('sample')
  await host.getByRole('button', { name: 'Run and show result' }).click()
  await page.getByText('Review app action', { exact: true }).waitFor()
  assert.equal(executions.length, 0)
  await page.getByRole('button', { name: 'Approve once', exact: true }).click()
  await host.getByTitle('posthog · Synthetic analytics interactive result').waitFor()
  const proxy = await (await host.getByTitle('posthog · Synthetic analytics interactive result').elementHandle()).contentFrame()
  await proxy.locator('iframe').waitFor()
  const widget = await (await proxy.locator('iframe').elementHandle()).contentFrame()
  await widget.getByText('Sample: 42', { exact: true }).waitFor()
  assert.deepEqual(executions, ['query'])
  const queryCalls = widgetRequests.filter(value => value.name === 'query')
  assert.equal(queryCalls[0].invocationId, queryCalls[1].invocationId)
  pass('The actual Ri approval overlay retries the same gated invocation and renders its captured result once')
  await widget.getByRole('button', { name: 'Filter sample' }).click()
  await widget.getByText('Filtered sample: 42', { exact: true }).waitFor()
  assert.deepEqual(executions, ['query', 'filter'])
  assert.equal(widgetRequests.find(value => value.name === 'filter').audience, 'app')
  pass('A nested widget calls an app-only tool through its selected account channel')
  await page.getByRole('button', { name: 'Chat about result', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Temporary demo chat' });
  const permission = chat.getByRole('checkbox', { name: 'Allow calls on this account', exact: true });
  assert.equal(await permission.isChecked(), false); await permission.check();
  await chat.getByRole('textbox', { name: 'Message the demo agent' }).fill('Run the updated sample query');
  await chat.getByRole('button', { name: 'Send demo message' }).click();
  await chat.getByText('Review this account action before it runs.', { exact: true }).waitFor();
  assert.deepEqual(executions, ['query', 'filter']);
  await chat.getByRole('button', { name: 'Approve once', exact: true }).click();
  await chat.getByText('Applied to this view through MCP', { exact: true }).waitFor();
  const revisedProxy = await (await host.getByTitle('posthog · Synthetic analytics interactive result').elementHandle()).contentFrame();
  const revised = await (await revisedProxy.locator('iframe').elementHandle()).contentFrame();
  await revised.getByText('Updated sample: 84', { exact: true }).waitFor();
  assert.deepEqual(executions, ['query', 'filter', 'chat:query']);
  pass('The account demo chat requires explicit permission and approval, then renders one captured result without sending private metadata to the agent');
  const before = methods.length
  await page.evaluate(value => window.postMessage(value, '*'), { kind: 'ri-account-rpc', handle, channel: randomUUID(), rpc: { id: 900, method: 'tools/list' } })
  await page.waitForTimeout(250)
  assert.equal(methods.length, before)
  assert.equal((await context.cookies([config.hostOrigin, config.sandboxOrigin])).length, 0)
  pass('Wrong-frame requests are ignored and the isolated app origins receive no Ri cookie')
  await host.evaluate(() => location.reload())
  await host.getByRole('status').filter({ hasText: 'Session ended.' }).waitFor()
  await host.getByRole('button', { name: 'Run and show result' }).waitFor()
  assert.deepEqual(executions, ['query', 'filter', 'chat:query'])
  assert.equal(await host.locator('iframe').count(), 0)
  pass('Reload starts a new discovery channel, discards the result and never repeats either tool')
  await page.screenshot({ path: join(root, 'evidence/ri-account-fixture.png') })
  await page.getByRole('button', { name: 'Return to Plugins', exact: true }).click()
  await until(() => ended)
  pass('Returning to Plugins revokes the temporary account handle')
  writeFileSync(join(root, 'evidence/account-fixture-verification.json'), JSON.stringify({ testedAt: new Date().toISOString(), mode: 'Controlled account protocol fixtures in the actual built Ri UI', checks, executions }, null, 2) + '\n')
} catch (error) {
  console.error('Account fixture verification failed:', error.message.split('Call log:')[0])
  console.log('Controlled methods:', methods, 'executions:', executions)
  const host = await page.getByTitle('Interactive plugin examples').count() ? await (await page.getByTitle('Interactive plugin examples').elementHandle())?.contentFrame() : null
  console.log('Controlled view:', (await host?.locator('body').innerText())?.slice(0, 1400))
  await page.screenshot({ path: join(root, 'evidence/account-fixture-diagnostic.png') })
  process.exitCode = 1
} finally { closing = true; await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close() }
