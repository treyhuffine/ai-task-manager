import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createRemoteServers } from './remote-server.mjs'
import { validDiagramArguments } from './diagram-chat.mjs'

test('diagram updates require the exact checkpoint and bounded non-executable elements', () => {
  const args = elements => ({ elements: JSON.stringify(elements) })
  const restore = { type: 'restoreCheckpoint', id: 'owned' }
  assert.equal(validDiagramArguments(args([restore, { type: 'rectangle', id: 'done', label: { text: 'Done' } }]), 'owned'), true)
  for (const invalid of [[], [restore], [{ ...restore, id: 'other' }, { type: 'text' }], [restore, restore], [restore, { type: 'image', fileId: 'private' }], [restore, { type: 'html', html: '<script>' }], [restore, null], [restore, ...Array(200).fill({ type: 'text' })]]) assert.equal(validDiagramArguments(args(invalid), 'owned'), false)
  assert.equal(validDiagramArguments({ ...args([restore, { type: 'text' }]), export: true }, 'owned'), false)
  assert.equal(validDiagramArguments({ elements: 'x'.repeat(64001) }, 'owned'), false)
})

test('real host routes bind model edits and captured replay to one diagram, preserving private metadata and stale edits', async () => {
  let executions = 0, referenceReads = 0, writes = 0, failWrite = false, failCreate = false
  const config = { parentOrigin: 'https://ri.example', hostOrigin: 'https://app.example', sandboxOrigin: 'https://sandbox.example', key: 'a'.repeat(64) }
  let now = Date.now()
  const { host, sandbox } = createRemoteServers(config, () => now, { publicSend: async (_url, rpc) => {
    let result = {}
    if (rpc.params?.name === 'create_view') { executions++; result = failCreate ? { isError: true, content: [] } : { content: [{ type: 'text', text: 'Prepared sample diagram' }], structuredContent: { checkpointId: `checkpoint_${executions}` }, _meta: { privateUi: 'captured only' } } }
    if (rpc.params?.name === 'read_me') { referenceReads++; result = { content: [{ type: 'text', text: 'Format reference' }], _meta: { privateUi: 'reference secret' } } }
    if (rpc.params?.name === 'save_checkpoint') { writes++; result = failWrite ? { isError: true, content: [] } : { content: [] } }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })) }
  } })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  async function send(path, body, admin = false) {
    const response = await fetch(`http://127.0.0.1:${host.address().port}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Host: admin ? '127.0.0.1' : 'app.example', ...(admin ? { 'x-ri-evaluation-key': config.key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    return { status: response.status, text, json: () => JSON.parse(text) }
  }
  const call = (name, args, invocationId = randomUUID()) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: { 'ri/evaluationInvocation': invocationId } } })
  try {
    const { token } = (await send('/__launch', {}, true)).json(), prefix = `/s/${token}`
    const viewId = randomUUID(), otherView = randomUUID()
    await send(prefix + '/mcp/excalidraw', call('create_view', { elements: '[{"type":"text","text":"Sample"}]' }, viewId))
    await send(prefix + '/mcp/excalidraw', call('create_view', { elements: '[{"type":"text","text":"Other sample"}]' }, otherView))
    const initial = (await send(prefix + `/api/diagram?invocationId=${viewId}`)).json()
    assert.deepEqual(initial, { checkpointId: 'checkpoint_1', version: 0, ready: true })
    const context = { invocationId: viewId, revision: 2, kind: 'public', app: 'Excalidraw', view: 'Diagram', text: 'Sample diagram', diagram: { checkpointId: initial.checkpointId, version: initial.version } }
    const register = (turnId, ctx = context) => send('/__chat/begin', { token, turnId, context: ctx, allowChanges: true }, true)
    assert.equal((await register(randomUUID(), { ...context, invocationId: otherView })).status, 400)
    assert.equal((await register(randomUUID(), { ...context, kind: 'account' })).status, 400)
    const turnId = randomUUID(), path = prefix + `/chat/${turnId}`
    assert.equal((await register(turnId)).status, 200)
    const tools = (await send(path + '/mcp', { id: 2, method: 'tools/list' })).json().result.tools
    assert.deepEqual(tools.map(tool => tool.name), ['read_me', 'create_view'])
    assert.equal(tools[1].annotations.readOnlyHint, false)
    assert.equal((await send(path + '/mcp', call('read_checkpoint', { id: 'checkpoint_1' }))).status, 403)
    assert.equal((await send(path + '/mcp', { id: 3, method: 'resources/read', params: { uri: 'ui://excalidraw/mcp-app.html' } })).status, 403)
    const reference = await send(path + '/mcp', call('read_me', {}))
    assert.equal(reference.status, 200)
    assert.equal(reference.text.includes('reference secret'), false)
    await send(path + '/mcp', call('read_me', {}))
    assert.equal(referenceReads, 1)
    const args = { elements: '[{"type":"restoreCheckpoint","id":"checkpoint_1"},{"type":"rectangle","id":"done","label":{"text":"Done"}}]' }
    assert.equal((await send(path + '/mcp', call('create_view', { elements: args.elements.replace('checkpoint_1', 'checkpoint_2') }))).status, 400)
    const model = await send(path + '/mcp', call('create_view', args))
    assert.equal(model.status, 200)
    assert.equal(model.text.includes('_meta'), false)
    assert.equal(model.text.includes('captured only'), false)
    assert.match(model.json().result.content[0].text, /host has not applied it yet/)
    assert.equal((await send(path + '/mcp', call('create_view', args))).status, 409)
    assert.equal(executions, 3)
    assert.deepEqual((await send('/__chat/result', { token, turnId }, true)).json(), { status: 'ready', diagram: { invocationId: viewId, checkpointId: 'checkpoint_3' } })
    const resultPath = path + `/result?invocationId=${viewId}`
    for (let i = 0; i < 2; i++) {
      const captured = (await send(resultPath)).json()
      assert.deepEqual(captured.arguments, args)
      assert.equal(captured.result._meta.privateUi, 'captured only')
    }
    assert.equal((await send(path + `/result?invocationId=${otherView}`)).status, 409)
    assert.equal((await send(path + `/apply?invocationId=${otherView}`, {})).status, 409)
    assert.equal((await send(path + `/apply?invocationId=${viewId}`, {})).status, 200)
    assert.equal((await send(path + `/apply?invocationId=${viewId}`, {})).status, 409)
    assert.equal((await send(resultPath)).status, 409)
    assert.equal((await send(prefix + `/api/diagram?invocationId=${viewId}`)).json().checkpointId, 'checkpoint_3')
    assert.equal((await send(prefix + `/api/diagram?invocationId=${otherView}`)).json().checkpointId, 'checkpoint_2')
    assert.equal(executions, 3)
    const current = { ...context, diagram: { checkpointId: 'checkpoint_3', version: 0 } }
    const lateTurn = randomUUID(), latePath = prefix + `/chat/${lateTurn}`
    await register(lateTurn, current)
    await send(latePath + '/mcp', call('create_view', { elements: args.elements.replace('checkpoint_1', 'checkpoint_3') }))
    await send(prefix + '/mcp/excalidraw', call('save_checkpoint', { id: 'checkpoint_3', data: '{"elements":[]}' }))
    await send(prefix + '/mcp/excalidraw', call('save_checkpoint', { id: 'checkpoint_3', data: '{"elements":[]}' }))
    assert.equal(writes, 2, 'Distinct accepted calls remain distinct executions')
    assert.equal((await send(prefix + `/api/diagram?invocationId=${viewId}`)).json().version, 1, 'Identical saved data does not invent a newer edit')
    assert.equal((await send(latePath + `/apply?invocationId=${viewId}`, {})).status, 409)
    assert.equal((await register(randomUUID(), current)).status, 400)
    assert.equal(executions, 4)
    const failedTurn = randomUUID(), failedPath = prefix + `/chat/${failedTurn}`
    await register(failedTurn, { ...current, diagram: { checkpointId: 'checkpoint_3', version: 1 } })
    failCreate = true
    const failedCall = await send(failedPath + '/mcp', call('create_view', { elements: args.elements.replace('checkpoint_1', 'checkpoint_3') }))
    assert.equal(failedCall.status, 200)
    assert.equal(failedCall.json().result.isError, true)
    assert.equal((await send(failedPath + '/mcp', call('create_view', { elements: args.elements.replace('checkpoint_1', 'checkpoint_3') }))).status, 409)
    assert.deepEqual((await send('/__chat/result', { token, turnId: failedTurn }, true)).json(), { status: 'unknown' })
    failWrite = true
    await send(prefix + '/mcp/excalidraw', call('save_checkpoint', { id: 'checkpoint_3', data: '{"elements":[]}' }))
    assert.equal((await send(prefix + `/api/diagram?invocationId=${viewId}`)).json().ready, false)
    assert.equal((await register(randomUUID(), { ...current, diagram: { checkpointId: 'checkpoint_3', version: 2 } })).status, 400)
    await send(prefix + `/api/diagram/close?invocationId=${viewId}`, {})
    assert.equal((await send(prefix + `/api/diagram?invocationId=${viewId}`)).status, 404)
    now += 30 * 60 * 1000
    assert.equal((await send(failedPath + '/mcp', call('create_view', args))).status, 410)
    assert.equal(executions, 5)
  } finally { await new Promise(resolve => host.close(resolve)); sandbox.close() }
})
