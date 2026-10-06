import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root, serverEnv } from './config.mjs'
import { verifyChatFlow, verifyChatRead, verifyPublicChatRead } from './verify-chat-flow.mjs'
import { verifyThirdPartyFlow } from './verify-third-party-flow.mjs'

const config = JSON.parse(readFileSync(join(root, 'remote.json'), 'utf8'))
const { chromium } = createRequire(join(root, 'host/package.json'))('playwright-core')
const executablePath = process.env.RI_MCP_APPS_BROWSER || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, env: serverEnv() })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
page.setDefaultTimeout(30000)
const calls = [], checks = [], requests = [], routeErrors = []
let closing = false
context.on('request', request => {
  if (!request.url().startsWith(config.hostOrigin) && !request.url().startsWith(config.sandboxOrigin)) return
  requests.push({ url: request.url(), cookie: request.headers().cookie, authorization: request.headers().authorization })
  if (request.method() !== 'POST') return
  try { const rpc = request.postDataJSON(); if (rpc?.method === 'tools/call') calls.push(rpc.params.name) } catch { /* Not an MCP body. */ }
})
const count = name => calls.filter(call => call === name).length
function pass(name) { checks.push(name); console.log('PASS ' + name) }
async function until(check, message) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(message)
}
async function resultFrame(host, title) {
  const proxy = await (await host.getByTitle(title, { exact: true }).elementHandle()).contentFrame()
  await proxy.locator('iframe').waitFor()
  return { proxy, view: await (await proxy.locator('iframe').elementHandle()).contentFrame() }
}

try {
  let host
  if (process.argv.includes('--sandbox')) {
    // Exercise the actual public HTTPS origins inside a synthetic parent on
    // the real Ri origin, without reading Ri data or importing a credential.
    await context.addCookies([{ name: 'ri_cookie_probe', value: 'synthetic', url: config.parentOrigin, httpOnly: true, sameSite: 'Lax', secure: true }])
    await context.route(config.parentOrigin + '/__evaluation-test', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Synthetic Ri test parent</h1><iframe title="Interactive plugin examples" sandbox="allow-scripts allow-same-origin" referrerpolicy="origin" style="width:100%;height:980px;border:0"></iframe></main>' }))
    await page.goto(config.parentOrigin + '/__evaluation-test')
    const launched = await fetch('http://127.0.0.1:48885/__launch', { method: 'POST', headers: { 'x-ri-evaluation-key': config.key } })
    const { token } = await launched.json()
    await page.getByTitle('Interactive plugin examples').evaluate((frame, url) => { frame.src = url }, `${config.hostOrigin}/s/${token}/index.html`)
  } else {
    // Only the Ri top-level page receives its existing viewer credential.
    // Neither init scripts nor example frames receive a Ri token.
    const require = createRequire(import.meta.url)
    const { readAuthConfig } = require('../../src/lib/auth/config-file.ts')
    const token = readAuthConfig()?.localToken
    if (!token) throw new Error('No existing Ri viewer credential is available.')
    if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) {
      const testHome = new URL(process.env.RI_MCP_APPS_TEST_HOME_ORIGIN)
      if (testHome.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(testHome.hostname)) throw new Error('The synthetic test Home must be local.')
      // Test the actual built Ri UI with synthetic data. Only Ri requests are
      // rerouted locally. The examples still traverse their live HTTPS tunnels.
      await context.route(config.parentOrigin + '/**', async route => {
        const url = new URL(route.request().url())
        // A bounded test stream avoids a permanently pending route on exit.
        if (url.pathname === '/api/live') { await route.fulfill({ contentType: 'text/event-stream', body: '' }); return }
        try {
          const response = await route.fetch({ url: testHome.origin + url.pathname + url.search, timeout: 120000 })
          await route.fulfill({ response })
        } catch (error) {
          if (closing) return
          routeErrors.push({ path: url.pathname, message: error.message.split('Call log:')[0] })
          await route.fulfill({ status: 503, body: 'Synthetic test Home request failed' }).catch(() => {})
        }
      })
      await context.addInitScript(origin => { if (location.origin === origin) localStorage.setItem('ri.client.apiTransport', 'http') }, config.parentOrigin)
    }
    await page.goto(config.parentOrigin + '/?settings=plugins#token=' + encodeURIComponent(token))
    await page.getByRole('button', { name: 'Try interactive examples', exact: true }).click()
  }
  await page.getByTitle('Interactive plugin examples', { exact: true }).waitFor()
  host = await (await page.getByTitle('Interactive plugin examples', { exact: true }).elementHandle()).contentFrame()
  await host.getByText('Connected to the pinned local official example.').waitFor()
  await host.getByText("Connected to Excalidraw's public server.", { exact: true }).waitFor()
  await host.getByText("Connected to Microsoft's public Flint server.", { exact: true }).waitFor()
  await host.getByText('Connected to the public Dutch building-data server.', { exact: true }).waitFor()
  await host.getByText('Connected to tldraw\'s public server.', { exact: true }).waitFor()
  assert.equal(calls.length, 0)
  pass('The HTTPS view discovers four public servers and the local scenario without invoking a tool')
  assert.equal((await context.cookies([config.hostOrigin, config.sandboxOrigin])).length, 0)
  pass('Ri cookies do not reach either HTTPS example origin')

  await host.getByRole('button', { name: 'Open scenario example', exact: true }).click()
  const scenario = await resultFrame(host, 'SaaS Scenario Modeler interactive result')
  await scenario.view.getByText('$63.4K', { exact: true }).waitFor()
  await scenario.view.getByRole('slider').nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await scenario.view.getByText('$67.2K', { exact: true }).waitFor()
  await scenario.view.getByRole('combobox').selectOption('bootstrapped')
  await scenario.view.getByText('vs. Bootstrapped Growth', { exact: true }).waitFor()
  await scenario.view.getByRole('button', { name: 'Reset', exact: true }).click()
  await scenario.view.getByText('$63.4K', { exact: true }).waitFor()
  assert.equal(count('get-scenario-data'), 1)
  pass('Scenario sliders, comparison and reset work over Beamd')

  if (process.argv.includes('--chat')) {
    if (!process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) throw new Error('Chat qualification requires the isolated synthetic Ri Home.')
    await verifyChatFlow({ page, context, host, scenario, config, pass })
  } else if (process.argv.includes('--read-chat')) {
    await verifyChatRead({ page, scenario, pass })
    await page.getByRole('button', { name: 'Hide demo chat', exact: true }).click()
  }

  await host.getByRole('button', { name: 'Open diagram example', exact: true }).click()
  const diagram = await resultFrame(host, 'Excalidraw interactive result')
  await diagram.view.getByText('Move a shape or add a label in Edit.', { exact: true }).waitFor()
  assert.equal(await diagram.view.evaluate(() => { try { void top.document.body; return false } catch (error) { return error.name === 'SecurityError' } }), true)
  assert.equal(await diagram.view.evaluate(() => typeof window.electron), 'undefined')
  assert.ok(diagram.proxy.url().startsWith(config.sandboxOrigin))
  pass('The real app retains its nested sandbox, DOM isolation and lack of desktop IPC')

  await diagram.view.getByTitle('Enter fullscreen', { exact: true }).click()
  await host.getByRole('button', { name: 'Return to examples', exact: true }).waitFor()
  const canvas = diagram.view.locator('canvas').last()
  await canvas.waitFor({ state: 'visible' })
  await canvas.click({ position: { x: 250, y: 150 } })
  await page.keyboard.press('t')
  await canvas.click({ position: { x: 250, y: 150 } })
  await diagram.view.locator('textarea').waitFor({ state: 'visible' })
  await page.keyboard.type('Remote Ri example')
  await canvas.click({ position: { x: 450, y: 150 } })
  await until(() => count('save_checkpoint') > 0, 'The remote editor did not save its checkpoint')
  await host.getByRole('button', { name: 'Return to examples', exact: true }).click()
  await diagram.view.getByText('Remote Ri example', { exact: true }).waitFor()
  assert.equal(count('create_view'), 1)
  pass('Excalidraw editing and return preserve the same invocation over HTTPS')
  const publicViews = await verifyThirdPartyFlow({ page, host, resultFrame, count, pass })
  if (process.argv.includes('--chat') || process.argv.includes('--read-chat')) {
    await verifyPublicChatRead({ page, host, table: publicViews.table, calls, pass })
  }
  await host.getByRole('region', { name: 'Excalidraw result', exact: true }).getByTitle('Close', { exact: true }).click()
  await host.getByRole('button', { name: 'Open canvas example', exact: true }).click()
  const tldraw = await resultFrame(host, 'tldraw interactive result')
  // Qualify past the SDK's five-second production license gate, not only
  // the provisional canvas that appears immediately after initialization.
  await page.waitForTimeout(7000)
  const licenseFailure = host.getByRole('alert').filter({ hasText: 'SDK license check' })
  assert.equal(count('exec'), 1)
  if (await licenseFailure.count()) {
    await licenseFailure.waitFor()
    assert.equal(await host.getByTitle('tldraw interactive result', { exact: true }).isVisible(), false)
    pass('The hosted tldraw license gate fails locally with a visible explanation and retained text')
  } else {
    await tldraw.view.getByText('Ri sample workflow', { exact: true }).first().waitFor()
    await tldraw.view.locator('.tl-canvas').waitFor({ state: 'visible' })
    pass('The real tldraw MCP app executes the fixed sample on its qualified interactive canvas')
    await tldraw.view.getByText('Ri sample workflow', { exact: true }).first().dblclick()
    const label = tldraw.view.locator('[contenteditable="true"],textarea').first()
    await label.fill('Remote Ri canvas')
    await page.keyboard.press('Escape')
    await tldraw.view.getByText('Remote Ri canvas', { exact: true }).first().waitFor()
    await host.getByRole('region', { name: 'tldraw result', exact: true }).getByText('📋 Model Context', { exact: true }).click()
    await until(async () => (await host.getByRole('region', { name: 'tldraw result', exact: true }).innerText()).includes('Remote Ri canvas'), 'The edited canvas did not share its latest context')
    assert.equal(count('exec'), 1)
    pass('Editing the real tldraw canvas updates attached context without repeating its initial execution')
  }
  if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) {
    mkdirSync(join(root, 'evidence'), { recursive: true })
    await page.screenshot({ path: join(root, 'evidence/ri-remote-examples.png') })
  }

  const before = calls.length
  await host.evaluate(() => location.reload())
  await host.getByRole('status').filter({ hasText: 'Session ended.' }).waitFor()
  await host.getByText('Connected to the pinned local official example.').waitFor()
  assert.equal(calls.length, before)
  assert.equal(await host.locator('iframe').count(), 0)
  pass('Reload ends the example session without replaying a tool')
  assert.ok(requests.every(request => !request.cookie && !request.authorization))
  pass('No Ri cookie or Authorization header is sent to the examples')
  if (!process.argv.includes('--sandbox')) {
    await page.getByRole('button', { name: 'Return to Plugins', exact: true }).click()
    await page.getByRole('button', { name: 'Try interactive examples', exact: true }).waitFor()
    await until(() => page.getByRole('button', { name: 'Try interactive examples', exact: true }).evaluate(element => element === document.activeElement), 'Focus did not return to the launcher')
    assert.equal(await page.getByTitle('Interactive plugin examples').count(), 0)
    pass('The actual Ri entry opens and returns to Plugins in the same tab')
    await page.reload()
    await page.getByRole('button', { name: 'Try interactive examples', exact: true }).waitFor()
    assert.equal(await page.getByTitle('Interactive plugin examples').count(), 0)
    assert.equal(calls.length, before)
    pass('Reloading Ri leaves the examples closed and never replays a tool')
    if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) await page.screenshot({ path: join(root, 'evidence/ri-plugins-entry.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Try interactive examples', exact: true }).click()
    await page.getByRole('button', { name: 'Return to Plugins', exact: true }).click()
    await page.getByRole('button', { name: 'Try interactive examples', exact: true }).waitFor()
    assert.equal(calls.length, before)
    pass('A narrow Ri view keeps a visible return path without invoking tools')
  }
  mkdirSync(join(root, 'evidence'), { recursive: true })
  assert.deepEqual(routeErrors, [])
  const mode = process.argv.includes('--sandbox') ? 'synthetic-parent' : process.env.RI_MCP_APPS_TEST_HOME_ORIGIN ? 'isolated-ri' : 'actual-ri'
  const chatVerification = process.argv.includes('--chat') ? { readHarness: 'claude', changes: 'Controlled replies with actual captured MCP results' } : process.argv.includes('--read-chat') ? { readHarness: 'claude', changes: 'Read only' } : null
  writeFileSync(join(root, 'evidence/remote-verification.json'), JSON.stringify({ testedAt: new Date().toISOString(), mode, checks, browserCalls: calls, chatVerification }, null, 2) + '\n')
} catch (error) {
  if (process.argv.includes('--sandbox')) {
    const example = await (await page.getByTitle('Interactive plugin examples').elementHandle())?.contentFrame()
    console.log('Public example test page:', (await example?.locator('body').innerText())?.slice(0, 3000))
    mkdirSync(join(root, 'evidence'), { recursive: true })
    await page.screenshot({ path: join(root, 'evidence/third-party-diagnostic.png') })
  }
  if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) {
    console.log('Synthetic Ri test page:', page.url().split('#')[0], (await page.locator('body').innerText()).slice(0,2500))
    await page.screenshot({ path: join(root, 'evidence/ri-ui-diagnostic.png') })
  }
  // Playwright's HTTP call log can include the parent viewer header. Report
  // the assertion or timeout without copying that log into console output.
  console.error('Verification failed:', error.message.split('Call log:')[0])
  process.exitCode = 1
} finally {
  closing = true
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
}
