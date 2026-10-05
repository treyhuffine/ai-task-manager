import { randomUUID } from 'node:crypto'
import { parseRpc } from './public-servers.mjs'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ELEMENT_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line', 'freedraw', 'cameraUpdate', 'delete'])
function stateFor(session) { return session.publicServers?.get('excalidraw') }
function checkpointState(state, id) { return state.checkpointVersions?.get(id) ?? { version: 0, pending: 0, unknown: false } }

export function diagramContext(session, invocationId) {
  const state = stateFor(session), diagram = state?.diagrams?.get(invocationId)
  if (!diagram) return null
  const checkpoint = checkpointState(state, diagram.checkpointId)
  return { checkpointId: diagram.checkpointId, version: checkpoint.version, ready: checkpoint.pending === 0 && !checkpoint.unknown }
}

export function admitDiagramTurn(session, context) {
  if (context?.kind !== 'public' || context.app !== 'Excalidraw' || context.view !== 'Diagram' || !UUID.test(context.invocationId)) return null
  const current = diagramContext(session, context.invocationId)
  if (!current?.ready || current.checkpointId !== context.diagram?.checkpointId || current.version !== context.diagram?.version) return null
  return { invocationId: context.invocationId, checkpointId: current.checkpointId, version: current.version }
}

function currentTurn(session, turn) {
  const current = diagramContext(session, turn.diagram.invocationId)
  return !!current?.ready && current.checkpointId === turn.diagram.checkpointId && current.version === turn.diagram.version
}

export function validDiagramArguments(args, checkpointId) {
  if (!args || Object.keys(args).length !== 1 || typeof args.elements !== 'string' || Buffer.byteLength(args.elements) > 64000) return false
  try {
    const elements = JSON.parse(args.elements)
    return Array.isArray(elements) && elements.length > 1 && elements.length <= 200
      && elements[0]?.type === 'restoreCheckpoint' && elements[0].id === checkpointId && Object.keys(elements[0]).every(key => ['type', 'id'].includes(key))
      && elements.slice(1).every(element => element && typeof element === 'object' && !Array.isArray(element) && ELEMENT_TYPES.has(element.type))
  } catch { return false }
}

function response(rpc, result, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc?.id ?? null, result })) }
}
function refusal(rpc, message, status = 403) {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32000, message } })) }
}

// The model receives two public tools, never the widget-only checkpoint tools,
// HTML or private result metadata. Each accepted update is captured exactly once.
export async function diagramChatRpc(proxy, session, turn, rpc) {
  if (rpc.method === 'initialize') return response(rpc, { protocolVersion: rpc.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'excalidraw_demo', version: '1.0.0' } })
  if (rpc.method === 'notifications/initialized') return { status: 202, headers: { 'Cache-Control': 'no-store' }, body: Buffer.alloc(0) }
  if (rpc.method === 'ping') return response(rpc, {})
  if (rpc.method === 'resources/list') return response(rpc, { resources: [] })
  if (rpc.method === 'tools/list') return response(rpc, { tools: turn.allowChanges ? [
    { name: 'read_me', description: 'Read the public Excalidraw element format before updating the diagram.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'create_view', description: 'Revise the attached sample diagram. Call at most once. Start the elements array with the exact restoreCheckpoint in your current context, then add elements or delete existing IDs. The host renders the captured result after your reply.', inputSchema: { type: 'object', properties: { elements: { type: 'string', maxLength: 64000 } }, required: ['elements'], additionalProperties: false }, annotations: { readOnlyHint: false } },
  ] : [] })
  if (rpc.method !== 'tools/call' || !turn.allowChanges || !['read_me', 'create_view'].includes(rpc.params?.name)) return refusal(rpc, 'This turn cannot perform that diagram operation')
  if (!currentTurn(session, turn)) return refusal(rpc, 'The attached diagram changed. Send a new message with its current context.', 409)
  const name = rpc.params.name
  if (name === 'read_me') {
    if (Object.keys(rpc.params.arguments ?? {}).length) return refusal(rpc, 'The reference tool takes no arguments')
    turn.reference ??= proxy('excalidraw', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {}, _meta: { 'ri/evaluationInvocation': randomUUID() } } }, session)
    const saved = await turn.reference
    try {
      const value = parseRpc(saved.body, saved.headers['Content-Type'])
      if (!value.result) return refusal(rpc, 'The reference is unavailable. No call was repeated.', 502)
      return response(rpc, { content: value.result.content, isError: value.result.isError })
    } catch { return refusal(rpc, 'The reference is unavailable. No call was repeated.', 502) }
  }
  if (!validDiagramArguments(rpc.params.arguments, turn.diagram.checkpointId)) return refusal(rpc, 'Use the exact attached checkpoint followed by bounded diagram elements', 400)
  if (turn.status !== 'unused') return refusal(rpc, 'This turn already submitted its update. No call was repeated.', 409)
  turn.status = 'unknown'
  turn.arguments = structuredClone(rpc.params.arguments)
  const saved = await proxy('excalidraw', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: turn.arguments, _meta: { 'ri/evaluationInvocation': turn.turnId } } }, session)
  try {
    const value = parseRpc(saved.body, saved.headers['Content-Type'])
    const checkpointId = value.result?.structuredContent?.checkpointId
    if (value.result?.isError) return response(rpc, { content: value.result.content, isError: true })
    if (value.error) return refusal(rpc, typeof value.error.message === 'string' ? value.error.message.slice(0, 1000) : 'The public server rejected the update. No call was repeated.', saved.status)
    if (saved.status !== 200 || value.result?.isError || typeof checkpointId !== 'string' || !stateFor(session).checkpoints.has(checkpointId) || saved.body.length > 256 * 1024) throw new Error('Unknown outcome')
    turn.result = value.result
    turn.checkpointId = checkpointId
    turn.status = 'ready'
    return response(rpc, { content: [{ type: 'text', text: 'Diagram revision prepared through MCP. The host has not applied it yet. It will check the current diagram and permission after your reply. Tell the human you prepared a revision, without claiming the visible diagram changed.' }], structuredContent: value.result.structuredContent })
  } catch { return refusal(rpc, 'The update outcome is unknown. No call was repeated.', 502) }
}

export function capturedDiagram(session, turn, invocationId, apply = false) {
  if (!turn.diagram || turn.status !== 'ready' || invocationId !== turn.diagram.invocationId || turn.applied || !currentTurn(session, turn)) return null
  const payload = { kind: 'diagram', invocationId, arguments: turn.arguments, result: turn.result, checkpointId: turn.checkpointId }
  if (apply) {
    // Only this captured child result may advance the originating view.
    stateFor(session).diagrams.get(invocationId).checkpointId = turn.checkpointId
    turn.applied = true
  }
  return payload
}
