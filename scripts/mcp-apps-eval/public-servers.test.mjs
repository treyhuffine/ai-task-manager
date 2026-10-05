import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createPublicProxy, PUBLIC_SERVERS, validPublicCsp } from './public-servers.mjs'

const call = (name, args, invocation = randomUUID(), id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { 'ri/evaluationInvocation': invocation } } })
function response(rpc, value) { return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: value })) } }
const session = () => ({ calls: 0 })

test('remote allowlists reject arbitrary tools, resources, file data and private addresses', async () => {
  let executions = 0
  const proxy = createPublicProxy(async (_url, rpc) => { executions++; return response(rpc, {}) })
  for (const [server, rpc] of [
    ['flint', call('create_chart_view', { data: { url: '/Users/agent/private.csv' } })],
    ['flint', call('render_chart', { data: { values: [] } })],
    ['buildings', call('get_building_profile', { postcode: '9999XX', huisnummer: 1 })],
    ['buildings', call('get_building_profile', { postcode: '1071XX', huisnummer: 1, url: 'http://127.0.0.1' })],
    ['excalidraw', call('export_to_excalidraw', {})],
    ['excalidraw', { id: 1, method: 'resources/read', params: { uri: 'file:///private' } }],
    ['flint', { id: 1, method: 'tools/call', params: { name: 'list_themes' } }],
  ]) assert.equal((await proxy(server, rpc, session())).status, 403)
  assert.equal(executions, 0)
  assert.equal(validPublicCsp({ resourceDomains: ['https://tile.openstreetmap.org'] }), true)
  for (const domain of ['*', 'https://ri-trey.beamd.run', 'http://127.0.0.1:4224', 'https://evil.example']) assert.equal(Boolean(validPublicCsp({ connectDomains: [domain] })), false)
})

test('captures simultaneous and repeated deliveries once, distinguishes explicit calls and never retries unknown outcomes', async () => {
  let executions = 0, fail = false
  const proxy = createPublicProxy(async (url, rpc) => {
    assert.equal(url, PUBLIC_SERVERS.flint.url)
    assert.equal(rpc.params._meta['ri/evaluationInvocation'], undefined)
    executions++
    if (fail) throw new Error('Unknown outcome')
    await new Promise(resolve => setTimeout(resolve, 10))
    return response(rpc, { content: [{ type: 'text', text: 'Chart ready' }], _meta: { privateResult: 'preserved' } })
  })
  const state = session(), invocation = randomUUID(), rpc = call('list_themes', {}, invocation)
  const [a, b] = await Promise.all([proxy('flint', rpc, state), proxy('flint', { ...rpc, id: 2 }, state)])
  assert.equal(executions, 1)
  assert.equal(JSON.parse(a.body).id, 1)
  assert.equal(JSON.parse(b.body).id, 2)
  assert.equal(JSON.parse(b.body).result._meta.privateResult, 'preserved')
  assert.equal((await proxy('flint', call('list_themes', { different: true }, invocation), state)).status, 409)
  assert.equal((await proxy('flint', call('list_themes', {}), state)).status, 200)
  assert.equal(executions, 2)
  fail = true
  const unknown = call('list_themes', {})
  assert.equal((await proxy('flint', unknown, state)).status, 502)
  assert.equal((await proxy('flint', unknown, state)).status, 409)
  assert.equal(executions, 3)
})

test('UI contracts stay intact while unqualified tools and network policies are rejected', async () => {
  let unsafe = false
  const proxy = createPublicProxy(async (_url, rpc) => response(rpc, rpc.method === 'tools/list'
    ? { tools: [{ name: 'create_view', _meta: { ui: { resourceUri: 'ui://excalidraw/mcp-app.html' } } }, { name: 'save_checkpoint', _meta: { ui: { visibility: ['app'] } } }, { name: 'delete_everything' }] }
    : { contents: [{ uri: rpc.params.uri, mimeType: 'text/html;profile=mcp-app', text: '<h1>View</h1>', _meta: { ui: { csp: { connectDomains: unsafe ? ['http://localhost:4224'] : ['https://esm.sh'] } } } }] }))
  const listed = JSON.parse((await proxy('excalidraw', { id: 1, method: 'tools/list' }, session())).body).result
  assert.equal(listed.tools.length, 2)
  assert.deepEqual(listed.tools[1]._meta.ui.visibility, ['app'])
  const resource = { id: 2, method: 'resources/read', params: { uri: 'ui://excalidraw/mcp-app.html' } }
  assert.equal((await proxy('excalidraw', resource, session())).status, 200)
  unsafe = true
  assert.equal((await proxy('excalidraw', resource, session())).status, 502)
})

test('public checkpoints stay bound to the capability that created them', async () => {
  let executions = 0
  const proxy = createPublicProxy(async (_url, rpc) => { executions++; return response(rpc, { structuredContent: { checkpointId: 'owned-checkpoint' }, content: [] }) })
  const owner = session(), other = session()
  assert.equal((await proxy('excalidraw', call('create_view', { elements: '[{"type":"text","text":"Sample"}]' }), owner)).status, 200)
  assert.equal((await proxy('excalidraw', call('read_checkpoint', { id: 'owned-checkpoint' }), owner)).status, 200)
  assert.equal((await proxy('excalidraw', call('read_checkpoint', { id: 'owned-checkpoint' }), other)).status, 403)
  assert.equal((await proxy('excalidraw', call('save_checkpoint', { id: 'other-checkpoint', data: '{}' }), owner)).status, 403)
  assert.equal((await proxy('excalidraw', call('create_view', { elements: '[{"type":"restoreCheckpoint","id":"owned-checkpoint"}]' }), other)).status, 403)
  assert.equal(executions, 2)
})
