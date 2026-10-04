import { createServer, request as httpRequest } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './config.mjs'

const LOCAL_HOST = 'http://ri-mcp-apps.127.0.0.1.nip.io:48880'
const LOCAL_SANDBOX = 'http://ri-mcp-sandbox.127.0.0.1.sslip.io:48881'
const SESSION_MS = 30 * 60 * 1000
const LIMIT = 20 * 1024 * 1024

export function validOrigins(parentOrigin, hostOrigin, sandboxOrigin) {
  const origins = [parentOrigin, hostOrigin, sandboxOrigin]
  return new Set(origins).size === 3 && origins.every(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password } catch { return false }
  })
}

export function createRemoteServers(config, now = Date.now) {
  const { parentOrigin, hostOrigin, sandboxOrigin, key } = config
  if (!validOrigins(parentOrigin, hostOrigin, sandboxOrigin) || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid isolated HTTPS configuration')
  const sessions = new Map()
  function reply(res, status, body, type = 'text/plain') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'origin', 'X-Content-Type-Options': 'nosniff' })
    res.end(body)
  }
  function authorized(req) {
    const provided = req.headers['x-ri-evaluation-key']
    return typeof provided === 'string' && /^[a-f0-9]{64}$/.test(provided) && timingSafeEqual(Buffer.from(provided), Buffer.from(key))
  }
  function sessionFor(path) {
    for (const [token, value] of sessions) if (value.expires <= now()) sessions.delete(token)
    const match = path.match(/^\/s\/([a-f0-9]{64})(\/.*)$/)
    const session = match && sessions.get(match[1])
    return session ? { token: match[1], session, path: match[2] } : null
  }
  // Only fixed, synthetic MCP fixtures are exposed. No Ri route, arbitrary
  // URL, cookie, Authorization header or upstream credential is forwarded.
  async function proxyMcp(req, res, entry, port) {
    if (!['POST', 'DELETE'].includes(req.method)) { reply(res, 405, 'Method not supported'); return }
    const chunks = []
    let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { reply(res, 413, 'Input too large'); return } chunks.push(chunk) }
    const body = Buffer.concat(chunks)
    if (req.method === 'POST') {
      let rpc
      try { rpc = JSON.parse(body) } catch { reply(res, 400, 'Invalid JSON'); return }
      const methods = ['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read']
      const tools = port === 48883 ? ['create_view', 'save_checkpoint', 'read_checkpoint'] : ['get-scenario-data']
      if (!methods.includes(rpc?.method) || rpc.method === 'tools/call' && !tools.includes(rpc.params?.name)) { reply(res, 403, 'Unsupported example operation'); return }
      if (rpc.method === 'tools/call' && ++entry.session.calls > 80) { reply(res, 429, 'Example session call limit reached'); return }
    }
    const headers = { Host: `ri-mcp-apps.127.0.0.1.nip.io:${port}`, Origin: LOCAL_HOST, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
    for (const name of ['mcp-session-id', 'mcp-protocol-version']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name]
    await new Promise(resolve => {
      const upstream = httpRequest({ host: '127.0.0.1', port, path: '/mcp', method: req.method, headers }, response => {
        const output = []
        let length = 0
        response.on('data', chunk => { length += chunk.length; if (length > LIMIT) { upstream.destroy(); reply(res, 413, 'Result too large'); resolve() } else output.push(chunk) })
        response.on('end', () => {
          if (res.writableEnded) return
          const outgoing = { 'Content-Type': response.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store' }
          if (response.headers['mcp-session-id']) outgoing['mcp-session-id'] = response.headers['mcp-session-id']
          res.writeHead(response.statusCode || 502, outgoing); res.end(Buffer.concat(output)); resolve()
        })
        response.on('error', () => { if (!res.writableEnded) reply(res, 502, 'Example server unavailable'); resolve() })
      })
      upstream.setTimeout(20000, () => upstream.destroy(new Error('Example timed out')))
      upstream.on('error', () => { if (!res.writableEnded) reply(res, 502, 'Example server unavailable'); resolve() })
      upstream.end(body)
    })
  }
  function hostCsp() {
    return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src ${hostOrigin}; frame-src ${sandboxOrigin}; frame-ancestors ${parentOrigin}; base-uri 'none'; form-action 'none'`
  }
  function readSandbox(search) {
    return new Promise((resolve, reject) => {
      const upstream = httpRequest({ host: '127.0.0.1', port: 48881, path: '/sandbox.html' + search, headers: { Host: 'ri-mcp-sandbox.127.0.0.1.sslip.io:48881' } }, response => {
        const chunks = []
        let size = 0
        response.on('data', chunk => { size += chunk.length; if (size > LIMIT) upstream.destroy(new Error('Sandbox too large')); else chunks.push(chunk) })
        response.on('error', reject)
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, html: Buffer.concat(chunks).toString('utf8') }))
      })
      upstream.setTimeout(5000, () => upstream.destroy(new Error('Sandbox unavailable')))
      upstream.on('error', reject)
      upstream.end()
    })
  }
  const host = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, hostOrigin)
      const hostname = (req.headers.host || '').split(':')[0]
      if (![new URL(hostOrigin).hostname, '127.0.0.1'].includes(hostname)) { reply(res, 404, 'Not found'); return }
      if (url.pathname === '/__launch' && hostname === '127.0.0.1' && req.method === 'POST' && authorized(req)) {
        for (const [token, value] of sessions) if (value.expires <= now()) sessions.delete(token)
        if (sessions.size >= 32) { reply(res, 429, 'Too many example sessions'); return }
        const token = randomBytes(32).toString('hex')
        const expires = now() + SESSION_MS
        sessions.set(token, { expires, calls: 0 })
        reply(res, 200, JSON.stringify({ token, expiresAt: new Date(expires).toISOString() }), 'application/json')
        return
      }
      const entry = sessionFor(url.pathname)
      if (!entry) { reply(res, 410, 'Example session ended. Return to Ri to open a new session.'); return }
      if (entry.path === '/api/servers' && req.method === 'GET') {
        reply(res, 200, JSON.stringify(['excalidraw', 'scenario'].map(name => `${hostOrigin}/s/${entry.token}/mcp/${name}`)), 'application/json')
      } else if (entry.path === '/index.html' && req.method === 'GET') {
        let html = readFileSync(join(root, 'host/dist/index.html'), 'utf8')
        html = html.replaceAll(LOCAL_SANDBOX + '/sandbox.html', `${sandboxOrigin}/s/${entry.token}/sandbox.html`)
        html = html.replaceAll('"/api/servers"', `"/s/${entry.token}/api/servers"`)
        // The one bridge to Ri reports readiness only. It has no tools,
        // context, composer, credentials or navigation authority in Ri.
        const ready = `<script>window.addEventListener('load',()=>window.parent.postMessage({kind:'ri-evaluation-ready'},${JSON.stringify(parentOrigin)}))</script>`
        res.setHeader('Content-Security-Policy', hostCsp())
        reply(res, 200, html.replace('</body>', ready + '</body>'), 'text/html')
      } else if (entry.path === '/mcp/excalidraw') await proxyMcp(req, res, entry, 48883)
      else if (entry.path === '/mcp/scenario') await proxyMcp(req, res, entry, 48882)
      else reply(res, 404, 'Not found')
    } catch { if (!res.writableEnded) reply(res, 502, 'Example view unavailable') }
  })
  const sandbox = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, sandboxOrigin)
      if ((req.headers.host || '').split(':')[0] !== new URL(sandboxOrigin).hostname) { reply(res, 404, 'Not found'); return }
      const entry = sessionFor(url.pathname)
      if (!entry || entry.path !== '/sandbox.html' || req.method !== 'GET') { reply(res, 410, 'Example session ended'); return }
      const upstream = await readSandbox(url.search)
      if (upstream.status !== 200) { reply(res, 502, 'Example sandbox unavailable'); return }
      const csp = upstream.headers['content-security-policy']
      if (!csp) { reply(res, 502, 'Example sandbox policy unavailable'); return }
      res.setHeader('Content-Security-Policy', csp.replace(/frame-ancestors [^;]+/, `frame-ancestors ${hostOrigin} ${sandboxOrigin} ${parentOrigin}`))
      const html = upstream.html.replace(/<html\b/, `<html data-evaluation-host-origin="${hostOrigin}"`)
      reply(res, 200, html, 'text/html')
    } catch { reply(res, 502, 'Example sandbox unavailable') }
  })
  return { host, sandbox }
}

if (process.argv.includes('--serve')) {
  const config = JSON.parse(readFileSync(join(root, 'remote-config.json'), 'utf8'))
  const { host, sandbox } = createRemoteServers(config)
  await Promise.all([
    new Promise((resolve, reject) => { host.once('error', reject); host.listen(48885, '127.0.0.1', resolve) }),
    new Promise((resolve, reject) => { sandbox.once('error', reject); sandbox.listen(48886, '127.0.0.1', resolve) }),
  ])
  writeFileSync(join(root, 'remote.json'), JSON.stringify({ format: 1, pid: process.pid, ...config }) + '\n', { mode: 0o600 })
  function stop() {
    if (existsSync(join(root, 'remote.json'))) unlinkSync(join(root, 'remote.json'))
    host.close(); sandbox.close(); setTimeout(() => process.exit(0), 1000)
  }
  process.on('SIGTERM', stop); process.on('SIGINT', stop)
}
