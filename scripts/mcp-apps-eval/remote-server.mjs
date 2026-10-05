import { createServer, request as httpRequest } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './config.mjs'
import { PUBLIC_SERVERS, createPublicProxy, validPublicCsp } from './public-servers.mjs'
import { admitDiagramTurn, capturedDiagram, diagramChatRpc, diagramContext } from './diagram-chat.mjs'

const LOCAL_HOST = 'http://ri-mcp-apps.127.0.0.1.nip.io:48880'
const LOCAL_SANDBOX = 'http://ri-mcp-sandbox.127.0.0.1.sslip.io:48881'
const SESSION_MS = 30 * 60 * 1000
const LIMIT = 20 * 1024 * 1024
const INPUT_RANGES = { startingMRR: [10000, 500000], monthlyGrowthRate: [0, 20], monthlyChurnRate: [0, 15], grossMargin: [50, 95], fixedCosts: [5000, 200000] }
export function validScenarioInputs(value) {
  return value && typeof value === 'object' && Object.keys(value).length === 5 && Object.entries(INPUT_RANGES).every(([name, [min, max]]) => typeof value[name] === 'number' && Number.isFinite(value[name]) && value[name] >= min && value[name] <= max)
}
function sameInputs(a, b) { return Object.keys(INPUT_RANGES).every(name => a?.[name] === b?.[name]) }
function rpcResponse(body, type) {
  if (type?.includes('text/event-stream')) {
    for (const event of body.toString('utf8').split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (!data) continue
      const parsed = JSON.parse(data)
      if ('result' in parsed || 'error' in parsed) return parsed
    }
    throw new Error('No MCP response')
  }
  return JSON.parse(body.toString('utf8'))
}

export function validOrigins(parentOrigin, hostOrigin, sandboxOrigin) {
  const origins = [parentOrigin, hostOrigin, sandboxOrigin]
  return new Set(origins).size === 3 && origins.every(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password } catch { return false }
  })
}

export function createRemoteServers(config, now = Date.now, { scenarioPort = 48882, publicSend } = {}) {
  const { parentOrigin, hostOrigin, sandboxOrigin, key } = config
  if (!validOrigins(parentOrigin, hostOrigin, sandboxOrigin) || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid isolated HTTPS configuration')
  const sessions = new Map()
  const publicProxy = createPublicProxy(publicSend)
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
  async function proxyMcp(req, res, entry, port, turn) {
    if (!['POST', 'DELETE'].includes(req.method)) { reply(res, 405, 'Method not supported'); return }
    const chunks = []
    let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { reply(res, 413, 'Input too large'); return } chunks.push(chunk) }
    const body = Buffer.concat(chunks)
    let captureCall = false
    if (req.method === 'POST') {
      let rpc
      try { rpc = JSON.parse(body) } catch { reply(res, 400, 'Invalid JSON'); return }
      const methods = ['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read']
      const tools = port === 48883 ? ['create_view', 'save_checkpoint', 'read_checkpoint'] : ['get-scenario-data']
      if (!methods.includes(rpc?.method) || rpc.method === 'tools/call' && !tools.includes(rpc.params?.name)) { reply(res, 403, 'Unsupported example operation'); return }
      if (turn?.publicView && rpc.method === 'tools/call') { reply(res, 403, 'Third-party attachments are read only. No tool is available.'); return }
      if (turn?.publicView && rpc.method === 'tools/list') { reply(res, 200, JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [] } }), 'application/json'); return }
      if (turn && rpc.method === 'resources/read') { reply(res, 403, 'UI resources are not part of the demo agent context'); return }
      if (turn && rpc.method === 'resources/list') { reply(res, 200, JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { resources: [] } }), 'application/json'); return }
      if (turn && rpc.method === 'tools/call') {
        const inputs = rpc.params?.arguments?.customInputs
        if (!validScenarioInputs(inputs) || Object.keys(rpc.params.arguments).some(name => name !== 'customInputs')) { reply(res, 400, 'Invalid sample scenario inputs'); return }
        if (!turn.allowChanges && !sameInputs(inputs, turn.base)) { reply(res, 403, 'This chat can read the sample scenario only'); return }
        if (turn.status !== 'unused') { reply(res, 409, 'This turn already called its tool. The original call was not repeated.'); return }
        // Capture inside the proxy, using a registered turn reference. The
        // model-facing harness transcript is never used as the UI payload.
        turn.status = 'unknown'
        turn.inputs = inputs
        captureCall = true
      }
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
          if (captureCall && turn.status === 'unknown' && !turn.result) {
            try {
              const captured = rpcResponse(Buffer.concat(output), response.headers['content-type'])
              if (length <= 256 * 1024 && response.statusCode === 200 && captured.result && !captured.result.isError) {
                turn.result = captured.result
                turn.status = 'ready'
              }
            } catch { /* An unknown outcome is never replayed. */ }
          }
          if (res.writableEnded || res.destroyed) { resolve(); return }
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
        sessions.set(token, { expires, calls: 0, turns: new Map() })
        reply(res, 200, JSON.stringify({ token, expiresAt: new Date(expires).toISOString() }), 'application/json')
        return
      }
      if (['/__chat/begin', '/__chat/result'].includes(url.pathname) && hostname === '127.0.0.1' && req.method === 'POST' && authorized(req)) {
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 16384) { reply(res, 413, 'Input too large'); return } chunks.push(chunk) }
        let input
        try { input = JSON.parse(Buffer.concat(chunks)) } catch { reply(res, 400, 'Invalid JSON'); return }
        if (!/^[a-f0-9]{64}$/.test(input.token) || !/^[a-f0-9-]{36}$/.test(input.turnId)) { reply(res, 400, 'Invalid turn reference'); return }
        const entry = sessionFor(`/s/${input.token}/index.html`)
        if (!entry) { reply(res, 410, 'Example session ended'); return }
        if (url.pathname === '/__chat/begin') {
          const diagram = input.allowChanges === true ? admitDiagramTurn(entry.session, input.context) : null
          const publicView = ['public', 'account'].includes(input.context?.kind) && ['Excalidraw', 'Flint charts', 'Building explorer', 'tldraw', 'Asana', 'Figma', 'PostHog'].includes(input.context.app) && typeof input.context.text === 'string' && input.context.text.length <= 12000 && (input.allowChanges === false || !!diagram)
          if (!publicView && (!validScenarioInputs(input.inputs) || typeof input.allowChanges !== 'boolean')) { reply(res, 400, 'Invalid example context'); return }
          if (entry.session.turns.has(input.turnId)) { reply(res, 409, 'This turn was already registered'); return }
          if (entry.session.turns.size >= 20) { reply(res, 429, 'Open a new example session after twenty chat turns'); return }
          entry.session.turns.set(input.turnId, { turnId: input.turnId, status: 'unused', base: input.inputs, publicView, diagram, allowChanges: diagram ? true : publicView ? false : input.allowChanges })
          reply(res, 200, '{}', 'application/json')
        } else {
          const turn = entry.session.turns.get(input.turnId)
          if (!turn) { reply(res, 404, 'Unknown turn'); return }
          reply(res, 200, JSON.stringify({ status: turn.status, ...(turn.status === 'ready' ? turn.diagram ? { diagram: { invocationId: turn.diagram.invocationId, checkpointId: turn.checkpointId } } : { inputs: turn.inputs } : {}) }), 'application/json')
        }
        return
      }
      const entry = sessionFor(url.pathname)
      if (!entry) { reply(res, 410, 'Example session ended. Return to Ri to open a new session.'); return }
      if (entry.path === '/api/diagram' && req.method === 'GET') {
        const context = diagramContext(entry.session, url.searchParams.get('invocationId'))
        reply(res, context ? 200 : 404, context ? JSON.stringify(context) : 'No attached diagram', 'application/json'); return
      }
      if (entry.path === '/api/diagram/close' && req.method === 'POST') {
        entry.session.publicServers?.get('excalidraw')?.diagrams.delete(url.searchParams.get('invocationId'))
        reply(res, 204, ''); return
      }
      if (entry.path === '/api/preset' && req.method === 'POST') {
        if (!['excalidraw', 'flint', 'buildings', 'tldraw'].includes(url.searchParams.get('example'))) { reply(res, 400, 'Unsupported example'); return }
        if (entry.session.presetOpened) { reply(res, 409, 'This example was already opened. No tool call was replayed.'); return }
        entry.session.presetOpened = true;
        reply(res, 204, ''); return
      }
      if (entry.path === '/api/servers' && req.method === 'GET') {
        const names = url.searchParams.has('account') ? [] : ['excalidraw', 'flint', 'buildings', 'tldraw', 'scenario']
        reply(res, 200, JSON.stringify(names.map(name => `${hostOrigin}/s/${entry.token}/mcp/${name}`)), 'application/json')
      } else if (entry.path === '/index.html' && req.method === 'GET') {
        let html = readFileSync(join(root, 'host/dist/index.html'), 'utf8')
        html = html.replaceAll(LOCAL_SANDBOX + '/sandbox.html', `${sandboxOrigin}/s/${entry.token}/sandbox.html`)
        html = html.replaceAll('"/api/servers"', `"/s/${entry.token}/api/servers"`)
        html = html.replace(/<html\b/, `<html data-evaluation-parent-origin="${parentOrigin}"`)
        // The bridge carries only the sample scenario and captured demo
        // result references. It has no Ri account or integration authority.
        const ready = `<script>window.addEventListener('load',()=>window.parent.postMessage({kind:'ri-evaluation-ready'},${JSON.stringify(parentOrigin)}))</script>`
        res.setHeader('Content-Security-Policy', hostCsp())
        reply(res, 200, html.replace('</body>', ready + '</body>'), 'text/html')
      } else if (entry.path === '/mcp/scenario') await proxyMcp(req, res, entry, scenarioPort)
      else if (entry.path === '/mcp/excalidraw-local') await proxyMcp(req, res, entry, 48883)
      else if (entry.path.startsWith('/mcp/') && PUBLIC_SERVERS[entry.path.slice(5)]) {
        if (req.method === 'DELETE') { reply(res, 204, ''); return }
        if (req.method !== 'POST') { reply(res, 405, 'Method not supported'); return }
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { reply(res, 413, 'Input too large'); return } chunks.push(chunk) }
        let rpc
        try { rpc = JSON.parse(Buffer.concat(chunks)) } catch { reply(res, 400, 'Invalid JSON'); return }
        const response = await publicProxy(entry.path.slice(5), rpc, entry.session)
        res.writeHead(response.status, { ...response.headers, 'Referrer-Policy': 'origin', 'X-Content-Type-Options': 'nosniff' })
        res.end(response.body)
      }
      else if (entry.path.match(/^\/chat\/[a-f0-9-]{36}\/(mcp|result|apply)$/)) {
        const turnId = entry.path.split('/')[2]
        const turn = entry.session.turns.get(turnId)
        if (!turn) { reply(res, 404, 'Unknown turn'); return }
        if (turn.diagram) {
          if (entry.path.endsWith('/mcp') && req.method === 'POST') {
            const chunks = []; let size = 0
            for await (const chunk of req) { size += chunk.length; if (size > 65536) { reply(res, 413, 'Input too large'); return } chunks.push(chunk) }
            let rpc
            try { rpc = JSON.parse(Buffer.concat(chunks)) } catch { reply(res, 400, 'Invalid JSON'); return }
            const response = await diagramChatRpc(publicProxy, entry.session, turn, rpc)
            res.writeHead(response.status, response.headers); res.end(response.body)
          } else if (entry.path.endsWith('/mcp') && req.method === 'DELETE') reply(res, 204, '')
          else if (entry.path.endsWith('/result') && req.method === 'GET' || entry.path.endsWith('/apply') && req.method === 'POST') {
            const payload = capturedDiagram(entry.session, turn, url.searchParams.get('invocationId'), entry.path.endsWith('/apply'))
            reply(res, payload ? 200 : 409, payload ? JSON.stringify(payload) : 'The diagram or its access changed. No call was replayed.', 'application/json')
          } else reply(res, 405, 'Method not supported')
        }
        else if (entry.path.endsWith('/mcp')) await proxyMcp(req, res, entry, scenarioPort, turn)
        else if (req.method === 'GET' && turn.status === 'ready') reply(res, 200, JSON.stringify({ inputs: turn.inputs, result: turn.result }), 'application/json')
        else reply(res, 409, 'No completed result. The tool was not replayed.')
      }
      else reply(res, 404, 'Not found')
    } catch { if (!res.writableEnded) reply(res, 502, 'Example view unavailable') }
  })
  const sandbox = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, sandboxOrigin)
      if ((req.headers.host || '').split(':')[0] !== new URL(sandboxOrigin).hostname) { reply(res, 404, 'Not found'); return }
      const entry = sessionFor(url.pathname)
      if (!entry || entry.path !== '/sandbox.html' || req.method !== 'GET') { reply(res, 410, 'Example session ended'); return }
      let policy
      try { policy = url.searchParams.has('csp') ? JSON.parse(url.searchParams.get('csp')) : undefined } catch { reply(res, 400, 'Invalid sandbox policy'); return }
      if (!validPublicCsp(policy)) { reply(res, 403, 'Unsupported sandbox network policy'); return }
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
