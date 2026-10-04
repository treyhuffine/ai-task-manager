import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import { createRemoteServers, validOrigins } from './remote-server.mjs'

test('requires three distinct HTTPS origins without embedded credentials', () => {
  assert.equal(validOrigins('https://ri.example', 'https://app.example', 'https://sandbox.example'), true)
  for (const host of ['https://ri.example', 'http://app.example', 'https://user:password@app.example', 'https://app.example/path']) {
    assert.equal(validOrigins('https://ri.example', host, 'https://sandbox.example'), false)
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
    assert.deepEqual(JSON.parse(servers.body), ['excalidraw', 'scenario'].map(name => config.hostOrigin + prefix + '/mcp/' + name))
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
