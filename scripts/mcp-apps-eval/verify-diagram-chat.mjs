import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, serverEnv } from './config.mjs'

const config = JSON.parse(readFileSync(join(root, 'remote.json'), 'utf8'))
const { chromium } = createRequire(join(root, 'host/package.json'))('playwright-core')
const { readAuthConfig } = createRequire(import.meta.url)('../../src/lib/auth/config-file.ts')
const token = readAuthConfig()?.localToken
if (!token) throw new Error('No Ri viewer credential is available')
const isolated = process.env.RI_MCP_APPS_TEST_HOME_ORIGIN
if (!isolated && !process.argv.includes('--live')) throw new Error('Use an isolated synthetic Home or explicitly pass --live for the sample diagram')
const executablePath = process.env.RI_MCP_APPS_BROWSER || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, env: serverEnv() })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
page.setDefaultTimeout(60000)
const checks = [], initialCalls = [], publicCalls = []
function pass(name) { checks.push(name); console.log('PASS ' + name) }
async function until(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(message)
}
context.on('request', request => {
  if (!request.url().startsWith(config.hostOrigin) || request.method() !== 'POST') return
  try { const rpc = request.postDataJSON(); if (rpc.method === 'tools/call' && rpc.params.name === 'create_view') initialCalls.push(rpc.params._meta?.['ri/evaluationInvocation']) } catch { /* Not an MCP body. */ }
})
context.on('response', async response => {
  const request = response.request()
  if (!request.url().startsWith(config.hostOrigin) || request.method() !== 'POST') return
  try {
    const rpc = request.postDataJSON()
    if (rpc.method !== 'tools/call') return
    const value = await response.json()
    publicCalls.push({ name: rpc.params.name, hasInvocation: /^[a-f0-9-]{36}$/i.test(rpc.params._meta?.['ri/evaluationInvocation'] ?? ''), keys: Object.keys(rpc.params.arguments ?? {}), status: response.status(), error: value.error?.message, isError: value.result?.isError })
  } catch { /* Not a completed MCP response. */ }
})
await page.addInitScript(({ parent, host }) => {
  if (location.origin !== parent) return
  window.__diagramContext = null
  window.addEventListener('message', event => {
    if (event.origin === host && event.data?.kind === 'ri-evaluation-context' && event.data.context?.app === 'Excalidraw') window.__diagramContext = event.data.context
  })
}, { parent: config.parentOrigin, host: config.hostOrigin })
if (isolated) {
  const local = new URL(isolated)
  if (local.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(local.hostname)) throw new Error('The synthetic Home must be local')
  await context.route(config.parentOrigin + '/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/live') return route.fulfill({ contentType: 'text/event-stream', body: '' })
    const response = await route.fetch({ url: local.origin + url.pathname + url.search, timeout: 120000 })
    await route.fulfill({ response })
  })
  await page.addInitScript(origin => { if (location.origin === origin) localStorage.setItem('ri.client.apiTransport', 'http') }, config.parentOrigin)
}
let stage = 'Open the Ri launcher'
try {
  await page.goto(config.parentOrigin + '/?settings=plugins#token=' + encodeURIComponent(token))
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Excalidraw', exact: true }) })
  await row.getByRole('button', { name: 'Open demo', exact: true }).click()
  const host = await (await page.getByTitle('Interactive plugin examples', { exact: true }).elementHandle()).contentFrame()
  async function drawing() {
    const proxy = await (await host.getByTitle('Excalidraw interactive result', { exact: true }).elementHandle()).contentFrame()
    await proxy.locator('iframe').waitFor()
    return (await proxy.locator('iframe').elementHandle()).contentFrame()
  }
  const diagramContext = () => page.evaluate(() => window.__diagramContext)
  let view = await drawing()
  await view.getByText('Capture', { exact: true }).waitFor()
  await until(async () => !!(await diagramContext())?.diagram, 'The host did not attach an owned checkpoint', 60000)
  assert.equal(initialCalls.length, 1)
  const originalCheckpoint = (await diagramContext()).diagram.checkpointId
  pass('Opening the Excalidraw row captures one real public invocation and its owned checkpoint')

  async function manualLabel(label) {
    view = await drawing()
    await view.getByTitle('Enter fullscreen', { exact: true }).click()
    const canvas = view.locator('canvas').last()
    await canvas.waitFor({ state: 'visible' })
    await canvas.click({ position: { x: 320, y: 400 } })
    await page.keyboard.press('t')
    await canvas.click({ position: { x: 320, y: 400 } })
    await view.locator('textarea').waitFor({ state: 'visible' })
    await page.keyboard.type(label)
    await canvas.click({ position: { x: 550, y: 400 } })
    await until(async () => (await diagramContext())?.text.includes(label), 'The latest manual edit did not reach the attached context', 30000)
    await host.getByRole('button', { name: 'Return to examples', exact: true }).click()
    await view.getByText(label, { exact: true }).waitFor()
  }
  stage = 'Preserve manual diagram edits'
  await manualLabel('Ri manual note')
  await page.getByRole('button', { name: 'Chat about result', exact: true }).click()
  const chat = page.getByRole('region', { name: 'Temporary demo chat' })
  const editor = chat.getByRole('textbox', { name: 'Message the demo agent' })
  const send = chat.getByRole('button', { name: 'Send demo message' })
  const updates = chat.getByRole('checkbox', { name: 'Allow updates to this diagram', exact: true })
  await updates.waitFor()
  assert.equal(await updates.isChecked(), false)
  await updates.check()
  await editor.fill('Add a green rectangle labeled Done after Execute. Preserve the existing Capture, Review, Execute steps and my Ri manual note. Update the diagram using MCP.')
  stage = 'Real Claude diagram update'
  await send.click()
  await editor.fill('Keep my next draft')
  await until(async () => await chat.getByText('Applied to this diagram through MCP', { exact: true }).count() > 0 || await chat.getByRole('alert').count() > 0 || await chat.getByRole('log').getByRole('status').filter({ hasNotText: /Applying the captured MCP result|Reading the attached example/ }).count() > 0, 'The real diagram turn did not finish', 120000)
  assert.equal(await chat.getByText('Applied to this diagram through MCP', { exact: true }).count(), 1, 'The changing turn did not apply its captured result')
  view = await drawing()
  for (const label of ['Capture', 'Review', 'Execute', 'Done', 'Ri manual note']) {
    stage = 'Rendered label: ' + label
    await view.getByText(label, { exact: true }).waitFor()
  }
  assert.equal(await editor.inputValue(), 'Keep my next draft')
  assert.equal(initialCalls.length, 1)
  await until(async () => (await diagramContext())?.text.includes('Done'), 'The updated diagram data did not flow back to the chat', 30000)
  pass('A real Claude MCP update adds Done to the same diagram while preserving manual edits and typing')

  const wrongCheckpoint = await view.evaluate(checkpoint => new Promise(resolve => {
    const id = 778899
    const listener = event => {
      if (event.source !== parent || event.data?.id !== id) return
      removeEventListener('message', listener)
      resolve(!!event.data.error)
    }
    addEventListener('message', listener)
    parent.postMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_checkpoint', arguments: { id: checkpoint } } }, '*')
  }), originalCheckpoint)
  assert.equal(wrongCheckpoint, true)
  pass('The remounted guest cannot read an older checkpoint through its current view bridge')

  stage = 'Read the agent-updated diagram'
  await updates.uncheck()
  await editor.fill('Which new step and which manual note can you see in the current attached diagram? Answer from the attachment, without changing anything.')
  await send.click()
  await chat.getByText('Read the attached third-party context. No new server call.', { exact: true }).waitFor({ timeout: 120000 })
  const reply = await chat.getByRole('log').innerText()
  assert.match(reply, /Done/)
  assert.match(reply, /Ri manual note/)
  pass('A subsequent read-only Claude reply sees the actual agent-updated checkpoint and the manual note')

  if (isolated) {
    stage = 'Controlled permission and stale-result checks'
    const sessionToken = new URL(host.url()).pathname.split('/')[2]
    async function admin(endpoint, body) {
      const response = await fetch(`http://127.0.0.1:48885/__chat/${endpoint}`, { method: 'POST', headers: { 'x-ri-evaluation-key': config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: sessionToken, ...body }) })
      assert.equal(response.status, 200)
      return response.json()
    }
    let release, captured, pending, label
    const pattern = config.parentOrigin + '/api/trpc/pluginEvaluation.chat*'
    await context.route(pattern, async route => {
      const body = route.request().postDataJSON(), input = body['0'] ?? body
      await admin('begin', { turnId: input.turnId, context: input.context, allowChanges: true })
      const arguments_ = { elements: JSON.stringify([{ type: 'restoreCheckpoint', id: input.context.diagram.checkpointId }, { type: 'text', id: input.turnId, x: 100, y: 450, text: label, fontSize: 20 }]) }
      const response = await fetch(`http://127.0.0.1:48885/s/${sessionToken}/chat/${input.turnId}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_view', arguments: arguments_ } }) })
      assert.equal(response.status, 200)
      await response.text()
      const tool = await admin('result', { turnId: input.turnId })
      assert.equal(tool.status, 'ready')
      captured()
      await pending
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).searchParams.get('batch') === '1' ? [{ result: { data: { text: 'Controlled reply with a real captured Excalidraw result.', turnId: input.turnId, context: input.context, tool } } }] : { result: { data: { text: 'Controlled reply with a real captured Excalidraw result.', turnId: input.turnId, context: input.context, tool } } }) })
    })
    async function hold(text) {
      label = text
      pending = new Promise(resolve => { release = resolve })
      const ready = new Promise(resolve => { captured = resolve })
      await updates.check()
      await editor.fill('Prepare ' + text)
      await send.click()
      await ready
    }
    const staleStatus = 'The diagram or its access changed. The result was not applied.'
    await hold('Permission revoked result')
    await updates.uncheck()
    release()
    await chat.getByText(staleStatus, { exact: true }).waitFor()
    assert.equal(await (await drawing()).getByText(label, { exact: true }).count(), 0)
    pass('Revoking the update checkbox while a reply is pending keeps the captured fork out of the view')
    const prior = await chat.getByText(staleStatus, { exact: true }).count()
    await hold('Stale agent result')
    await page.getByRole('button', { name: 'Hide demo chat', exact: true }).click()
    await manualLabel('Newer human edit')
    release()
    await page.getByRole('button', { name: 'Chat about result', exact: true }).click()
    await until(async () => await chat.getByText(staleStatus, { exact: true }).count() > prior, 'The late reply was not refused')
    assert.equal(await (await drawing()).getByText(label, { exact: true }).count(), 0)
    await (await drawing()).getByText('Newer human edit', { exact: true }).waitFor()
    pass('A newer manual edit defeats a stale agent result without replaying the accepted call')
    await context.unroute(pattern)
  }
  stage = 'Independent second chat and reload'
  await editor.fill('Chat one typing')
  await chat.getByRole('button', { name: 'Chat 2', exact: true }).click()
  assert.equal(await send.isEnabled(), false)
  await chat.getByRole('button', { name: 'Attach result', exact: true }).click()
  assert.equal(await updates.isChecked(), false)
  assert.equal(await editor.inputValue(), '')
  await editor.fill('Chat two typing')
  await chat.getByRole('button', { name: 'Chat 1', exact: true }).click()
  assert.equal(await editor.inputValue(), 'Chat one typing')
  pass('A second chat attaches the updated diagram explicitly with an independent draft and update permission')
  if (isolated) {
    mkdirSync(join(root, 'evidence'), { recursive: true })
    await host.getByTitle('Excalidraw interactive result', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(root, 'evidence/ri-excalidraw-agent-edit.png') })
  }
  await host.evaluate(() => location.reload())
  await host.getByRole('status').filter({ hasText: 'Session ended.' }).waitFor()
  assert.equal(initialCalls.length, 1)
  assert.equal(await host.locator('iframe').count(), 0)
  pass('Reload discards the diagram and temporary chats without rerunning create_view')
  await page.getByRole('button', { name: 'Return to Plugins', exact: true }).click()
  mkdirSync(join(root, 'evidence'), { recursive: true })
  writeFileSync(join(root, 'evidence/diagram-chat-verification.json'), JSON.stringify({ testedAt: new Date().toISOString(), mode: isolated ? 'isolated-ri' : 'actual-ri', checks, harness: 'claude', upstream: 'https://mcp.excalidraw.com/mcp' }, null, 2) + '\n')
} catch (error) {
  console.error('Verification failed at ' + stage + ': ' + error.message.split('Call log:')[0])
  if (isolated) {
    const chat = page.getByRole('region', { name: 'Temporary demo chat' })
    if (await chat.count()) console.log('Synthetic demo chat: ' + (await chat.innerText()).slice(0, 5000))
    for (const frame of page.frames()) {
      if (frame.url().startsWith(config.sandboxOrigin)) console.log('Synthetic view text: ' + (await frame.locator('body').innerText()).slice(0, 3000))
    }
    console.log('Synthetic current context: ' + JSON.stringify(await page.evaluate(() => window.__diagramContext)).slice(0, 4000))
    console.log('Public callback statuses: ' + JSON.stringify(publicCalls))
    mkdirSync(join(root, 'evidence'), { recursive: true })
    await page.screenshot({ path: join(root, 'evidence/diagram-chat-diagnostic.png') })
  }
  process.exitCode = 1
} finally {
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  await browser.close()
}
