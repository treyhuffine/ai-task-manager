import { request } from 'node:https'
import { createHash } from 'node:crypto'

// Public evaluation endpoints only. This is not Ri's integration gateway and
// cannot accept an account, credential, URL, file or Home configuration.
export const PUBLIC_SERVERS = {
  excalidraw: { url: 'https://mcp.excalidraw.com/mcp', tools: ['read_me', 'create_view', 'save_checkpoint', 'read_checkpoint'], resources: ['ui://excalidraw/mcp-app.html'] },
  flint: { url: 'https://flint.data-formulator.ai/mcp', tools: ['create_chart_view', 'validate_chart', 'list_chart_types', 'list_themes'], resources: ['ui://flint-chart/chart-view.html'] },
  buildings: { url: 'https://europe-west4-mcp-metadata-demo.cloudfunctions.net/mcpBest', tools: ['get_building_profile', 'render_map', 'render_table', 'render_chart'], resources: ['ui://metadata-demo/map.html', 'ui://metadata-demo/table.html', 'ui://metadata-demo/chart.html'] },
}
export const PUBLIC_DOMAINS = ['https://esm.sh', 'https://tile.openstreetmap.org']
const MAX_RESULT = 20 * 1024 * 1024
const MAX_CAPTURE = 512 * 1024
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function validPublicCsp(value) {
  if (value === undefined) return true
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, domains]) => ['resourceDomains', 'connectDomains', 'frameDomains', 'baseUriDomains'].includes(key)
      && Array.isArray(domains) && domains.length <= 4 && domains.every(domain => PUBLIC_DOMAINS.includes(domain)))
}

export function parseRpc(body, type) {
  if (!type?.includes('text/event-stream')) return JSON.parse(body.toString('utf8'))
  for (const event of body.toString('utf8').split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (!data) continue
    const parsed = JSON.parse(data)
    if ('result' in parsed || 'error' in parsed) return parsed
  }
  throw new Error('No completed MCP response')
}

function result(status, body) { return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: Buffer.from(JSON.stringify(body)) } }
function failure(rpc, message, status = 403) { return result(status, { jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32000, message } }) }
function boundedJson(value, limit) {
  try { return Buffer.byteLength(JSON.stringify(value)) <= limit } catch { return false }
}

export function publicRequestAllowed(name, rpc, state) {
  const server = PUBLIC_SERVERS[name]
  if (!server || !rpc || typeof rpc !== 'object' || Array.isArray(rpc)) return false
  if (!['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read'].includes(rpc.method)) return false
  if (rpc.method === 'resources/read') return server.resources.includes(rpc.params?.uri)
  if (rpc.method !== 'tools/call') return true
  const { name: tool, arguments: args = {} } = rpc.params ?? {}
  if (!server.tools.includes(tool) || !UUID.test(rpc.params?._meta?.['ri/evaluationInvocation'])) return false
  if (!args || typeof args !== 'object' || Array.isArray(args) || !boundedJson(args, 256 * 1024)) return false
  if (name === 'flint' && ['create_chart_view', 'validate_chart'].includes(tool)) {
    return args.data && Object.keys(args.data).every(key => key === 'values') && Array.isArray(args.data.values) && args.data.values.length <= 100
  }
  if (name === 'buildings' && tool === 'get_building_profile') {
    return ['1071XX:1', '1082PP:10'].includes(`${args.postcode}:${args.huisnummer}`)
      && Object.keys(args).every(key => ['postcode', 'huisnummer', 'queryIntent'].includes(key))
  }
  if (name === 'buildings' && tool === 'render_map') return Array.isArray(args.markers) && args.markers.length <= 20
  if (name === 'buildings' && tool === 'render_table') return boundedJson(args, 32768)
  if (name !== 'excalidraw') return true
  if (['save_checkpoint', 'read_checkpoint'].includes(tool)) return typeof args.id === 'string' && state.checkpoints.has(args.id)
  if (tool === 'create_view') {
    try {
      const elements = JSON.parse(args.elements)
      return Array.isArray(elements) && elements.length <= 500 && elements.every(e => e && typeof e === 'object' && (e.type !== 'restoreCheckpoint' || state.checkpoints.has(e.id)))
    } catch { return false }
  }
  return true
}

export function httpsMcpRequest(endpoint, rpc, sessionId, protocolVersion) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }
    // These values come from this server's response, never from the browser.
    if (sessionId) headers['mcp-session-id'] = sessionId
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion
    const upstream = request(new URL(endpoint), { method: 'POST', headers }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => { size += chunk.length; if (size > MAX_RESULT) upstream.destroy(new Error('Result too large')); else chunks.push(chunk) })
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode || 502, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    // There is no redirect, retry or forwarding of Ri/browser headers.
    upstream.setTimeout(30000, () => upstream.destroy(new Error('Public server timed out')))
    upstream.on('error', reject)
    upstream.end(JSON.stringify(rpc))
  })
}

export function createPublicProxy(send = httpsMcpRequest) {
  return async function proxy(name, rpc, session) {
    const server = PUBLIC_SERVERS[name]
    session.publicServers ??= new Map()
    let state = session.publicServers.get(name)
    if (!state) {
      state = { checkpoints: new Set(), deliveries: new Map(), protocolVersion: undefined, sessionId: undefined }
      session.publicServers.set(name, state)
    }
    if (!publicRequestAllowed(name, rpc, state)) return failure(rpc, 'Unsupported public example operation')
    const isCall = rpc.method === 'tools/call'
    const invocation = rpc.params?._meta?.['ri/evaluationInvocation']
    const fingerprint = isCall ? createHash('sha256').update(JSON.stringify(rpc.params)).digest('hex') : null
    if (isCall && state.deliveries.has(invocation)) {
      const prior = state.deliveries.get(invocation)
      if (prior.fingerprint !== fingerprint) return failure(rpc, 'Invocation was already used with different input', 409)
      const saved = await prior.promise
      if (!saved) return failure(rpc, 'Outcome unavailable. The original call was not repeated.', 409)
      return result(saved.status, { ...saved.rpc, id: rpc.id })
    }
    if (isCall && (++session.calls > 80 || state.deliveries.size >= 80)) return failure(rpc, 'Example session call limit reached', 429)
    async function execute() {
      try {
        const forwarded = structuredClone(rpc)
        if (isCall) delete forwarded.params._meta['ri/evaluationInvocation']
        const response = await send(server.url, forwarded, state.sessionId, state.protocolVersion)
        if (rpc.method === 'notifications/initialized') return { status: response.status, rpc: null }
        const parsed = parseRpc(response.body, response.headers['content-type'])
        if (rpc.method === 'initialize' && parsed.result) {
          state.sessionId = response.headers['mcp-session-id']
          state.protocolVersion = parsed.result.protocolVersion
        }
        if (rpc.method === 'tools/list' && parsed.result?.tools) parsed.result.tools = parsed.result.tools.filter(tool => server.tools.includes(tool.name))
        if (rpc.method === 'resources/list' && parsed.result?.resources) parsed.result.resources = parsed.result.resources.filter(resource => server.resources.includes(resource.uri))
        if (rpc.method === 'resources/read' && parsed.result) {
          const contents = parsed.result.contents
          if (!Array.isArray(contents) || contents.length !== 1 || contents[0].mimeType !== 'text/html;profile=mcp-app'
            || contents[0].uri !== rpc.params.uri || !validPublicCsp(contents[0]._meta?.ui?.csp)) throw new Error('Unsupported public UI resource')
          const permissions = contents[0]._meta?.ui?.permissions
          if (permissions && Object.keys(permissions).some(key => key !== 'clipboardWrite')) throw new Error('Unsupported view permission')
        }
        if (isCall && name === 'excalidraw' && !parsed.result?.isError) {
          const checkpoint = parsed.result?.structuredContent?.checkpointId
          if (typeof checkpoint === 'string' && checkpoint.length <= 128) {
            state.checkpoints.add(checkpoint)
          }
        }
        return { status: response.status, rpc: parsed }
      } catch { return null }
    }
    const pending = execute()
    if (isCall) state.deliveries.set(invocation, { fingerprint, promise: pending.then(saved => {
      if (!saved || !boundedJson(saved.rpc, MAX_CAPTURE)) return null
      const size = Buffer.byteLength(JSON.stringify(saved.rpc))
      session.capturedBytes ??= 0
      if (session.capturedBytes + size > 8 * 1024 * 1024) return null
      session.capturedBytes += size
      return saved
    }) })
    const saved = await pending
    if (!saved) return failure(rpc, 'Public server unavailable or outcome unknown. No tool call was replayed.', 502)
    if (saved.rpc === null) return { status: saved.status, headers: { 'Cache-Control': 'no-store' }, body: Buffer.alloc(0) }
    return result(saved.status, saved.rpc)
  }
}
