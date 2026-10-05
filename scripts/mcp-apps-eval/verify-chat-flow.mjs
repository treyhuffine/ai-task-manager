import assert from 'node:assert/strict'
import { join } from 'node:path'
import { root } from './config.mjs'

export async function verifyChatRead({ page, scenario, pass }) {
  const slider = scenario.view.getByRole('slider').nth(1)
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'Chat about scenario', exact: true }).click()
  const chat = page.getByRole('region', { name: 'Temporary demo chat' })
  // A section with aria-label has the region role.
  await chat.getByText('Scenario Modeler · Growth 6.5%', { exact: true }).waitFor()
  const editor = chat.getByRole('textbox', { name: 'Message the demo agent' })
  const send = chat.getByRole('button', { name: 'Send demo message' })
  const updates = chat.getByRole('checkbox', { name: 'Allow updates to the sample scenario' })
  assert.equal(await updates.isChecked(), false)
  await editor.fill('What monthly growth rate do you see? Use the MCP server to calculate month 12 MRR. Keep the inputs unchanged.')
  await send.click()
  await editor.fill('My next draft stays here')
  await chat.getByText('Read the sample data through MCP', { exact: true }).waitFor({ timeout: 90000 })
  const reply = await chat.getByRole('log').innerText()
  assert.match(reply, /6\.5/)
  assert.match(reply, /75[,.]?553|75\.6/)
  assert.equal(await editor.inputValue(), 'My next draft stays here')
  assert.equal(await slider.inputValue(), '6.5')
  pass('A real Claude MCP call reads the current UI values without overwriting a typed draft')
  await chat.getByRole('button', { name: 'Chat 2', exact: true }).click()
  assert.equal(await send.isEnabled(), false)
  await chat.getByRole('button', { name: 'Attach scenario', exact: true }).click()
  await chat.getByText('Scenario Modeler · Growth 6.5%', { exact: true }).waitFor()
  assert.equal(await editor.inputValue(), '')
  await chat.getByRole('button', { name: 'Chat 1', exact: true }).click()
  assert.equal(await editor.inputValue(), 'My next draft stays here')
  pass('The same view can be explicitly attached to a second temporary chat without sharing its draft')
  return { chat, editor, send, updates, slider }
}

export async function verifyPublicChatRead({ page, table, calls, pass }) {
  await page.getByRole('button', { name: 'Chat about result', exact: true }).click()
  const chat = page.getByRole('region', { name: 'Temporary demo chat' })
  const editor = chat.getByRole('textbox', { name: 'Message the demo agent' })
  const send = chat.getByRole('button', { name: 'Send demo message' })
  if (await chat.getByRole('button', { name: 'Remove scenario context' }).count()) {
    await chat.getByRole('button', { name: 'Remove scenario context' }).click()
  }
  if (!await chat.getByText('Building explorer · Table', { exact: true }).count()) {
    await chat.getByRole('button', { name: 'Attach Building explorer · Table', exact: true }).click()
  }
  await chat.getByText('Building explorer · Table', { exact: true }).waitFor()
  assert.equal(await chat.getByRole('checkbox').count(), 0)
  const before = calls.length
  await editor.fill('What address and construction year are in the attached table? Can you change the building record to 2026? Answer from the attachment without fetching anything.')
  await send.click()
  await editor.fill('Keep this third-party draft')
  await chat.getByText('Read the attached third-party context. No new server call.', { exact: true }).waitFor({ timeout: 90000 })
  const reply = await chat.getByRole('log').innerText()
  assert.match(reply, /1885/)
  assert.match(reply, /Museumstraat/i)
  assert.equal(await editor.inputValue(), 'Keep this third-party draft')
  // Exercise the portable app-to-host message method through the real nested
  // bridge. This is a controlled protocol message, not a table UI feature.
  await table.evaluate(() => parent.postMessage({ jsonrpc: '2.0', id: 8675309, method: 'ui/message', params: { role: 'user', content: [{ type: 'text', text: 'Discuss this public table selection' }] } }, '*'))
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !await editor.inputValue().then(value => value.includes('Discuss this public table selection'))) await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(await editor.inputValue(), 'Keep this third-party draft\n\n[Building explorer · Table] Discuss this public table selection')
  assert.equal(calls.length, before)
  pass('A controlled app-requested message is attributed and staged beside existing typing without automatic Send')
  assert.equal(calls.length, before)
  await table.getByText('1885', { exact: true }).waitFor()
  pass('A real Claude reply reads third-party building data without tools, changes or draft loss')
  if (process.env.RI_MCP_APPS_TEST_HOME_ORIGIN) {
    const host = await table.parentFrame().parentFrame()
    await host.getByTitle('metadata-demo-best interactive result', { exact: true }).last().scrollIntoViewIfNeeded()
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(root, 'evidence/ri-third-party-chat.png') })
  }
  await chat.getByRole('button', { name: 'Chat 2', exact: true }).click()
  if (await chat.getByRole('button', { name: 'Remove scenario context' }).count()) {
    await chat.getByRole('button', { name: 'Remove scenario context' }).click()
  }
  assert.equal(await send.isEnabled(), false)
  await chat.getByRole('button', { name: 'Attach Building explorer · Table', exact: true }).click()
  await chat.getByText('Building explorer · Table', { exact: true }).waitFor()
  assert.equal(await editor.inputValue(), '')
  await chat.getByRole('button', { name: 'Chat 1', exact: true }).click()
  assert.match(await editor.inputValue(), /^Keep this third-party draft/)
  await chat.getByRole('button', { name: 'Remove result context' }).click()
  assert.equal(await send.isEnabled(), false)
  await chat.getByRole('button', { name: 'Attach Excalidraw · Diagram', exact: true }).click()
  await chat.getByText('Excalidraw · Diagram', { exact: true }).waitFor()
  assert.match(await editor.inputValue(), /^Keep this third-party draft/)
  assert.equal(calls.length, before)
  pass('Third-party results can be tagged into either temporary chat without sending or replaying a tool')
  await page.getByRole('button', { name: 'Hide demo chat', exact: true }).click()
}

// Controlled changing replies run only with the isolated synthetic Home.
// They still use actual MCP capture and the real app's result delivery.
export async function verifyChatFlow({ page, context, host, scenario, config, pass }) {
  const { chat, editor, send, updates, slider } = await verifyChatRead({ page, scenario, pass })

  const token = new URL(host.url()).pathname.split('/')[2]
  let nextGrowth = 7, gate, release, captured
  async function admin(endpoint, body) {
    const response = await fetch(`http://127.0.0.1:48885/__chat/${endpoint}`, { method: 'POST', headers: { 'x-ri-evaluation-key': config.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  const pattern = config.parentOrigin + '/api/trpc/pluginEvaluation.chat*'
  await context.route(pattern, async route => {
    const body = route.request().postDataJSON()
    const input = body['0'] ?? body
    assert.equal(input.allowChanges, true)
    await admin('begin', { turnId: input.turnId, inputs: input.context.inputs, allowChanges: true })
    const inputs = { ...input.context.inputs, monthlyGrowthRate: nextGrowth }
    const upstream = await fetch(`http://127.0.0.1:48885/s/${token}/chat/${input.turnId}/mcp`, { method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get-scenario-data', arguments: { customInputs: inputs } } }) })
    assert.equal(upstream.status, 200)
    await upstream.text()
    const tool = await admin('result', { turnId: input.turnId })
    assert.equal(tool.status, 'ready')
    captured?.()
    if (gate) await gate
    const reply = { text: 'Controlled test reply using the real captured sample calculation.', turnId: input.turnId, context: input.context, tool }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ result: { data: reply } }]) })
  })
  try {
    await updates.check()
    await editor.fill('Set sample growth to 7%')
    await send.click()
    await chat.getByText('Applied to this scenario through MCP', { exact: true }).waitFor()
    assert.equal(await slider.inputValue(), '7')
    await chat.getByText('Scenario Modeler · Growth 7%', { exact: true }).waitFor()
    pass('A controlled captured MCP result updates the actual view and receives an acknowledgement')

    nextGrowth = 8
    gate = new Promise(resolve => { release = resolve })
    const ready = new Promise(resolve => { captured = resolve })
    await editor.fill('Set sample growth to 8%')
    await send.click()
    await ready
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    release()
    await chat.getByText('The scenario or its access changed. The result was not applied.', { exact: true }).waitFor()
    assert.equal(await slider.inputValue(), '7.5')
    pass('A late result cannot overwrite newer slider edits')

    gate = new Promise(resolve => { release = resolve })
    const ready2 = new Promise(resolve => { captured = resolve })
    await editor.fill('Set sample growth to 8% again')
    await send.click()
    await ready2
    await updates.uncheck()
    await editor.fill('Keep this draft after permission changes')
    release()
    await chat.getByText('The scenario or its access changed. The result was not applied.', { exact: true }).nth(1).waitFor()
    assert.equal(await slider.inputValue(), '7.5')
    assert.equal(await editor.inputValue(), 'Keep this draft after permission changes')
    pass('Revoking update permission during a reply preserves the view and new typing')

    await updates.check()
    gate = new Promise(resolve => { release = resolve })
    const ready3 = new Promise(resolve => { captured = resolve })
    await editor.fill('Set sample growth to 8% after detaching')
    await send.click()
    await ready3
    await chat.getByRole('button', { name: 'Remove scenario context' }).click()
    release()
    await chat.getByText('The scenario or its access changed. The result was not applied.', { exact: true }).nth(2).waitFor()
    assert.equal(await slider.inputValue(), '7.5')
    assert.equal(await send.isEnabled(), false)
    pass('Detaching context during a reply prevents application to the view')

    await chat.getByRole('button', { name: 'Attach scenario' }).click()
    await page.evaluate(() => window.postMessage({ kind: 'ri-evaluation-context', context: { invocationId: crypto.randomUUID(), revision: 999, inputs: { startingMRR: 50000, monthlyGrowthRate: 19, monthlyChurnRate: 3, grossMargin: 80, fixedCosts: 40000 } } }, location.origin))
    assert.equal(await chat.getByText('Scenario Modeler · Growth 7.5%', { exact: true }).count(), 1)
    pass('A message from the wrong frame source cannot attach or replace view context')
    await page.screenshot({ path: join(root, 'evidence/ri-demo-chat.png') })
    await host.evaluate(() => location.reload())
    await host.getByRole('status').filter({ hasText: 'Session ended.' }).waitFor()
    await page.getByRole('button', { name: 'Chat about scenario', exact: true }).click()
    await page.getByRole('region', { name: 'Temporary demo chat' }).getByRole('button', { name: 'Attach scenario' }).waitFor()
    assert.equal(await page.getByRole('log').getByText('Controlled test reply', { exact: false }).count(), 0)
    assert.equal(await page.getByRole('textbox', { name: 'Message the demo agent' }).inputValue(), '')
    pass('Reload discards both temporary chats and their attached authority without a replay')
    await page.getByRole('button', { name: 'Hide demo chat', exact: true }).click()
  } finally {
    release?.()
    await context.unroute(pattern)
  }
}
