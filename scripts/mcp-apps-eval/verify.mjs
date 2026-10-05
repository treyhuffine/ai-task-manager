import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { root, url, serverEnv } from './config.mjs'

// Resolve the evaluation's own pinned Playwright, never Ri's dependencies.
const require = createRequire(join(root, 'host/package.json'))
const { chromium } = require('playwright-core')
const executablePath = process.env.RI_MCP_APPS_BROWSER || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find(existsSync)
if (!executablePath) throw new Error('Set RI_MCP_APPS_BROWSER to an installed Chromium browser binary.')
const evidence = join(root, 'evidence')
mkdirSync(evidence, { recursive: true })
const checks = []
const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, env: serverEnv() })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const calls = []
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
context.on('request', (request) => {
  if (request.method() !== 'POST') return
  try {
    const rpc = request.postDataJSON()
    if (rpc?.method === 'tools/call') calls.push(rpc.params.name)
  } catch { /* Non-MCP requests are irrelevant. */ }
})
const count = (name) => calls.filter((call) => call === name).length
async function until(check, message, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}
function pass(name, details) {
  checks.push({ name, details })
  console.log(`PASS ${name}${details ? ': ' + details : ''}`)
}
async function ready(target = page) {
  await target.getByText('Connected to the pinned local official example.').waitFor()
  await target.getByText('Connected to the pinned local Excalidraw fallback.', { exact: false }).waitFor()
}
async function inner(title) {
  const outer = await page.getByTitle(title, { exact: true }).elementHandle()
  const proxy = await outer.contentFrame()
  await proxy.locator('iframe').waitFor()
  const frame = await (await proxy.locator('iframe').elementHandle()).contentFrame()
  return { proxy, frame }
}

try {
  await context.addCookies([
    { name: 'ri_cookie_probe', value: 'synthetic', url: 'http://localhost:4224/', httpOnly: true, sameSite: 'Lax' },
    { name: 'ri_ip_probe', value: 'synthetic', url: 'http://127.0.0.1:4224/', httpOnly: true, sameSite: 'Lax' },
    { name: 'broad_localhost_probe', value: 'synthetic', domain: 'localhost', path: '/' },
  ])
  assert.equal((await context.cookies([url, 'http://ri-mcp-sandbox.127.0.0.1.sslip.io:48881'])).length, 0)
  pass('Ri host-only session cookies do not reach either evaluation hostname')
  await page.goto(url)
  await ready()
  assert.equal(calls.length, 0)
  pass('Discovery opens both connections without executing a tool')

  await page.getByRole('button', { name: 'Open scenario example', exact: true }).click()
  const scenario = await inner('SaaS Scenario Modeler interactive result')
  await scenario.frame.getByText('$63.4K', { exact: true }).waitFor()
  assert.equal(count('get-scenario-data'), 1)
  await scenario.frame.getByRole('slider').nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await until(async () => !(await scenario.frame.getByText('$63.4K', { exact: true }).count()), 'Changing growth did not change the scenario summary')
  const scenarioAfterSlider = await scenario.frame.locator('body').innerText()
  assert.match(scenarioAfterSlider, /5\.5%/)
  await scenario.frame.getByRole('combobox').selectOption('bootstrapped')
  await scenario.frame.getByText('vs. Bootstrapped Growth', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 1800 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(evidence, 'scenario-comparison.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await scenario.frame.getByRole('button', { name: 'Reset', exact: true }).click()
  await scenario.frame.getByText('$63.4K', { exact: true }).waitFor()
  assert.equal(count('get-scenario-data'), 1)
  pass('Scenario sliders, comparison and reset work without additional tool calls', scenarioAfterSlider.match(/\$[^\n]+\nEnd MRR/)?.[0].replace('\n', ' '))

  await page.getByRole('button', { name: 'Open diagram example', exact: true }).click()
  const diagram = await inner('Excalidraw interactive result')
  await diagram.frame.getByText('Move a shape or add a label in Edit.', { exact: true }).waitFor()
  assert.equal(count('create_view'), 1)
  const originCheck = await diagram.frame.evaluate(() => {
    try { void window.top.document.body; return false } catch (error) { return error.name === 'SecurityError' }
  })
  assert.equal(originCheck, true)
  const outerSandbox = await page.getByTitle('Excalidraw interactive result').getAttribute('sandbox')
  const innerSandbox = await diagram.proxy.locator('iframe').getAttribute('sandbox')
  assert.match(outerSandbox, /allow-scripts/)
  assert.match(innerSandbox, /allow-scripts/)
  assert.ok(diagram.proxy.url().startsWith('http://ri-mcp-sandbox.127.0.0.1.sslip.io:48881/'))
  const csp = await context.request.get(diagram.proxy.url())
  assert.match(csp.headers()['content-security-policy'], /connect-src/)
  assert.match(csp.headers()['content-security-policy'], /form-action 'none'/)
  assert.equal(await diagram.frame.evaluate(() => typeof window.electron), 'undefined')
  pass('Reference double iframe, CSP and cross-origin DOM restriction are active')
  await page.setViewportSize({ width: 1440, height: 3200 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(evidence, 'both-apps-inline.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1100 })

  await page.waitForTimeout(800)
  await diagram.frame.getByTitle('Enter fullscreen', { exact: true }).click()
  await page.getByRole('button', { name: 'Return to examples', exact: true }).waitFor()
  await diagram.frame.locator('canvas').last().waitFor({ state: 'visible' })
  const canvas = diagram.frame.locator('canvas').last()
  await canvas.click({ position: { x: 250, y: 150 } })
  await page.keyboard.press('t')
  await canvas.click({ position: { x: 250, y: 150 } })
  await diagram.frame.locator('textarea').waitFor({ state: 'visible' })
  await page.keyboard.type('Ri demo note')
  await canvas.click({ position: { x: 450, y: 150 } })
  await until(() => count('save_checkpoint') > 0, 'The editor did not save the edited checkpoint')
  await page.screenshot({ path: join(evidence, 'excalidraw-editing.png') })
  await page.getByRole('button', { name: 'Return to examples', exact: true }).click()
  await diagram.frame.getByText('Ri demo note', { exact: true }).waitFor()
  await page.getByRole('region', { name: 'Excalidraw result', exact: true }).getByText('Model Context', { exact: false }).waitFor()
  assert.equal(count('create_view'), 1)
  assert.equal(await diagram.frame.evaluate(() => localStorage.length), 0)
  pass('Excalidraw text editing, app-only checkpoint call, context and return preserve the same result')
  await page.screenshot({ path: join(evidence, 'excalidraw-edited-inline.png'), fullPage: true })

  const beforeReload = { diagram: count('create_view'), scenario: count('get-scenario-data') }
  await page.reload()
  await ready()
  await page.getByRole('status').filter({ hasText: 'Session ended.' }).waitFor()
  assert.equal(await page.locator('iframe').count(), 0)
  assert.equal(count('create_view'), beforeReload.diagram)
  assert.equal(count('get-scenario-data'), beforeReload.scenario)
  await page.screenshot({ path: join(evidence, 'session-ended.png'), fullPage: true })
  await page.goto(url + '?server=Excalidraw&tool=create_view&call=true')
  await ready()
  await page.waitForTimeout(500)
  assert.equal(count('create_view'), beforeReload.diagram)
  assert.equal(await page.locator('iframe').count(), 0)
  pass('Reload and legacy call=true URLs never replay a tool', JSON.stringify(beforeReload))

  await page.getByText('Advanced: manual tool inputs', { exact: true }).click()
  await page.getByLabel('Server', { exact: true }).selectOption({ label: 'Excalidraw' })
  await page.getByLabel('Tool', { exact: true }).selectOption('create_view')
  await page.getByLabel('Input', { exact: true }).fill(JSON.stringify({ elements: 'invalid synthetic JSON' }))
  await page.getByRole('button', { name: 'Call Tool', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Tool failed:' }).waitFor()
  await page.screenshot({ path: join(evidence, 'tool-failure.png'), fullPage: true })
  pass('A real server tool error is visible')
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await until(async () => await page.locator('iframe').count() === 0, 'End session did not remove the view')

  await context.route('http://ri-mcp-apps.127.0.0.1.nip.io:48883/mcp', async (route) => {
    const rpc = route.request().postDataJSON()
    if (rpc?.method !== 'resources/read') { await route.continue(); return }
    await route.fulfill({ json: { jsonrpc: '2.0', id: rpc.id, result: {
      contents: [{ uri: rpc.params.uri, mimeType: 'text/plain', text: 'Synthetic malformed UI resource' }],
    } } })
  })
  await page.getByRole('button', { name: 'Open diagram example', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'View unavailable:' }).waitFor()
  await page.screenshot({ path: join(evidence, 'resource-failure.png'), fullPage: true })
  pass('Malformed UI resources fail locally with the tool result still visible')
  await context.unrouteAll()

  await page.reload()
  await ready()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open scenario example', exact: true }).click()
  const narrow = await inner('SaaS Scenario Modeler interactive result')
  await narrow.frame.getByText('$63.4K', { exact: true }).waitFor()
  await narrow.frame.getByRole('slider').nth(1).focus()
  await page.keyboard.press('ArrowRight')
  await narrow.frame.getByText('$67.2K', { exact: true }).waitFor()
  await page.getByTitle('SaaS Scenario Modeler interactive result', { exact: true }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(evidence, 'scenario-narrow.png') })
  pass('Example buttons and Scenario Modeler remain usable at 390px width')
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await until(async () => await page.locator('iframe').count() === 0, 'Narrow session did not close')

  await page.clock.install()
  await page.getByRole('button', { name: 'Open scenario example', exact: true }).click()
  const expiring = await inner('SaaS Scenario Modeler interactive result')
  await expiring.frame.getByText('$63.4K', { exact: true }).waitFor()
  const callsBeforeExpiry = calls.length
  await page.clock.fastForward(30 * 60 * 1000 + 1000)
  await page.getByRole('status').filter({ hasText: 'Session ended.' }).waitFor()
  await page.clock.fastForward(3000)
  await until(async () => await page.locator('iframe').count() === 0, 'Expired view did not close')
  assert.equal(calls.length, callsBeforeExpiry)
  pass('Expiry ends the view and does not execute a tool again')
  assert.deepEqual(pageErrors, [])
  pass('No uncaught browser errors')
  writeFileSync(join(evidence, 'verification.json'), JSON.stringify({
    date: new Date().toISOString(), browser: browser.version(), executablePath,
    checks, calls: Object.fromEntries([...new Set(calls)].map((name) => [name, count(name)])),
  }, null, 2) + '\n')
  console.log(`Evidence: ${evidence}`)
} catch (error) {
  await page.screenshot({ path: join(evidence, 'verification-failed.png'), fullPage: true }).catch(() => {})
  console.error('Browser state:', await page.locator('body').innerText().catch(() => 'unavailable'))
  throw error
} finally {
  await browser.close()
}
