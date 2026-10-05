import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createRemoteServers, validOrigins, validScenarioInputs } from './remote-server.mjs'

test('requires three distinct HTTPS origins without embedded credentials', () => {
  assert.equal(validOrigins('https://ri.example', 'https://app.example', 'https://sandbox.example'), true)
  for (const host of ['https://ri.example', 'http://app.example', 'https://user:password@app.example', 'https://app.example/path']) {
    assert.equal(validOrigins('https://ri.example', host, 'https://sandbox.example'), false)
  }
})

test('chat capture is scoped, bounded, read only unless enabled, and never replays a call', async () => {
  const inputs = { startingMRR: 50000, monthlyGrowthRate: 5, monthlyChurnRate: 3, grossMargin: 80, fixedCosts: 40000 }
  assert.equal(validScenarioInputs(inputs), true)
  for (const value of [{ ...inputs, monthlyGrowthRate: Infinity }, { ...inputs, monthlyChurnRate: -1 }, { ...inputs, extra: true }, {}]) assert.equal(Boolean(validScenarioInputs(value)), false)
  let executions = 0, failTool = false
  const original = { content: [{ type: 'text', text: 'Synthetic calculation' }], structuredContent: { currentInputs: inputs }, _meta: { privateSample: 'original payload' } }
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const rpc = JSON.parse(Buffer.concat(chunks))
    if (rpc.method === 'tools/call') executions++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'tools/call' ? failTool ? { isError: true, content: [] } : original : {} }) + '\n\n')
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const config = { parentOrigin: 'https://ri.example', hostOrigin: 'https://app.example', sandboxOrigin: 'https://sandbox.example', key: 'a'.repeat(64) }
  let now = Date.now()
  const { host, sandbox } = createRemoteServers(config, () => now, { scenarioPort: upstream.address().port })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  async function send(path, data, admin = false) {
    const response = await fetch(`http://127.0.0.1:${host.address().port}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Host: admin ? '127.0.0.1' : 'app.example', ...(admin ? { 'x-ri-evaluation-key': config.key } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    return { status: response.status, body: await response.text() }
  }
  try {
    const { token } = JSON.parse((await send('/__launch', {}, true)).body)
    const turnId = randomUUID(), path = `/s/${token}/chat/${turnId}`
    assert.equal((await send('/__chat/begin', { token, turnId, inputs, allowChanges: false })).status, 410)
    assert.equal((await send('/__chat/begin', { token, turnId, inputs, allowChanges: false }, true)).status, 200)
    assert.equal((await send('/__chat/begin', { token, turnId, inputs, allowChanges: true }, true)).status, 409)
    const call = customInputs => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get-scenario-data', arguments: { customInputs } } })
    assert.equal((await send(path + '/mcp', call({ ...inputs, monthlyGrowthRate: 7 }))).status, 403)
    assert.equal((await send(path + '/mcp', call({ ...inputs, startingMRR: 0 }))).status, 400)
    assert.equal((await send(path + '/mcp', { method: 'resources/read', params: { uri: 'ui://scenario' } })).status, 403)
    await send(path + '/mcp', { jsonrpc: '2.0', id: 2, method: 'initialize' })
    assert.deepEqual(JSON.parse((await send('/__chat/result', { token, turnId }, true)).body), { status: 'unused' })
    assert.equal((await send(path + '/mcp', call(inputs))).status, 200)
    assert.equal(executions, 1)
    assert.deepEqual(JSON.parse((await send('/__chat/result', { token, turnId }, true)).body), { status: 'ready', inputs })
    for (let i = 0; i < 2; i++) assert.deepEqual(JSON.parse((await send(path + '/result')).body), { inputs, result: original })
    assert.equal((await send(path + '/mcp', call(inputs))).status, 409)
    assert.equal(executions, 1)
    const other = JSON.parse((await send('/__launch', {}, true)).body).token
    assert.equal((await send(path.replace(token, other) + '/result')).status, 404)
    const publicId = randomUUID(), publicPath = `/s/${token}/chat/${publicId}`
    assert.equal((await send('/__chat/begin', { token, turnId: publicId, context: { kind: 'public', app: 'Building explorer', text: 'Public museum' }, allowChanges: false }, true)).status, 200)
    assert.deepEqual(JSON.parse((await send(publicPath + '/mcp', { id: 1, method: 'tools/list' })).body).result, { tools: [] })
    assert.equal((await send(publicPath + '/mcp', call(inputs))).status, 403)
    assert.equal(executions, 1)
    const updateId = randomUUID()
    await send('/__chat/begin', { token, turnId: updateId, inputs, allowChanges: true }, true)
    assert.equal((await send(`/s/${token}/chat/${updateId}/mcp`, call({ ...inputs, monthlyGrowthRate: 7 }))).status, 200)
    assert.equal(executions, 2)
    failTool = true
    const failedId = randomUUID(), failedPath = `/s/${token}/chat/${failedId}`
    await send('/__chat/begin', { token, turnId: failedId, inputs, allowChanges: true }, true)
    await send(failedPath + '/mcp', call(inputs))
    assert.deepEqual(JSON.parse((await send('/__chat/result', { token, turnId: failedId }, true)).body), { status: 'unknown' })
    assert.equal((await send(failedPath + '/result')).status, 409)
    assert.equal((await send(failedPath + '/mcp', call(inputs))).status, 409)
    assert.equal(executions, 3)
    now += 30 * 60 * 1000
    assert.equal((await send(path + '/result')).status, 410)
    assert.equal((await send(path + '/mcp', call(inputs))).status, 410)
    assert.equal(executions, 3)
  } finally {
    await Promise.all([new Promise(resolve => host.close(resolve)), new Promise(resolve => upstream.close(resolve))])
    sandbox.close()
  }
})

test('public access requires a locally minted bounded capability and allowed operations', async () => {
  let now = Date.now()
  const config = { parentOrigin: 'https://ri.example', hostOrigin: 'https://app.example', sandboxOrigin: 'https://sandbox.example', key: 'a'.repeat(64) }
  const { host, sandbox } = createRemoteServers(config, () => now)
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  function send(path, { hostname = 'app.example', key, body, method = 'GET' } = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: host.address().port, path, method, headers: { Host: hostname, ...(key ? { 'x-ri-evaluation-key': key } : {}) } }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject)
      req.end(body)
    })
  }
  try {
    assert.equal((await send('/')).status, 410)
    assert.equal((await send('/__launch', { method: 'POST', key: config.key })).status, 410)
    assert.equal((await send('/__launch', { hostname: '127.0.0.1', method: 'POST', key: 'b'.repeat(64) })).status, 410)
    assert.equal((await send('/__launch', { hostname: 'unrelated.example', method: 'POST', key: config.key })).status, 404)
    const minted = await send('/__launch', { hostname: '127.0.0.1', method: 'POST', key: config.key })
    assert.equal(minted.status, 200)
    const { token } = JSON.parse(minted.body)
    assert.match(token, /^[a-f0-9]{64}$/)
    const prefix = '/s/' + token
    const servers = await send(prefix + '/api/servers')
    assert.equal(servers.status, 200)
    assert.equal(servers.headers['cache-control'], 'no-store')
    assert.deepEqual(JSON.parse(servers.body), ['excalidraw', 'flint', 'buildings', 'tldraw', 'scenario'].map(name => config.hostOrigin + prefix + '/mcp/' + name))
    assert.equal((await send(prefix + '/api/preset?example=flint', { method: 'POST' })).status, 204)
    assert.equal((await send(prefix + '/api/preset?example=flint', { method: 'POST' })).status, 409)
    assert.equal((await send(prefix + '/api/tasks')).status, 404)
    assert.equal((await send(prefix + '/mcp/scenario', { method: 'POST', body: JSON.stringify({ method: 'tools/call', params: { name: 'delete_task' } }) })).status, 403)
    assert.equal((await send(prefix + '/mcp/excalidraw', { method: 'POST', body: JSON.stringify({ method: 'sampling/createMessage' }) })).status, 403)
    assert.equal((await send(prefix + '/mcp/excalidraw')).status, 405)
    for (let i = 1; i < 32; i++) assert.equal((await send('/__launch', { hostname: '127.0.0.1', method: 'POST', key: config.key })).status, 200)
    assert.equal((await send('/__launch', { hostname: '127.0.0.1', method: 'POST', key: config.key })).status, 429)
    now += 30 * 60 * 1000
    assert.equal((await send(prefix + '/api/servers')).status, 410)
    assert.equal((await send('/__launch', { hostname: '127.0.0.1', method: 'POST', key: config.key })).status, 200)
  } finally {
    await new Promise(resolve => host.close(resolve))
    sandbox.close()
  }
})
