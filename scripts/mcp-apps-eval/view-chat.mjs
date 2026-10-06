import { randomUUID } from 'node:crypto'
import { parseRpc } from './public-servers.mjs'

const APPS = { flint: 'Flint charts', buildings: 'Building explorer', tldraw: 'tldraw' }
const TOOL_NAMES = { flint: ['create_chart_view'], buildings: ['render_map', 'render_table'], tldraw: ['exec'] }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const json = (rpc, result) => ({ status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })) })
const refuse = (rpc, message, status = 403) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message } })) })

export function viewContext(session, invocationId) {
  for (const [provider, state] of session.publicServers ?? []) {
    const view = state.views?.get(invocationId)
    if (view && APPS[provider]) return { provider, toolName: view.toolName, version: view.version, canvasId: view.canvasId, ready: !view.pending && !view.unknown }
  }
  return null
}
export function admitViewTurn(session, context) {
  const view = viewContext(session, context?.invocationId)
  if (!view?.ready || context.kind !== 'public' || APPS[view.provider] !== context.app || context.update?.version !== view.version || !UUID.test(context.invocationId)) return null
  return { ...view, invocationId: context.invocationId }
}
function current(session, turn) {
  const view = viewContext(session, turn.view.invocationId)
  return view?.ready && view.provider === turn.view.provider && view.version === turn.view.version && view.canvasId === turn.view.canvasId
}

// Structured data is encoded as literals in a fixed script. Model-authored JS,
// URLs, assets and access to browser globals never enter this tool.
export function canvasScript(args) {
  if (!args || Object.keys(args).some(key => !['shapes', 'deleteIds'].includes(key)) || !Array.isArray(args.shapes) || args.shapes.length > 20 || !Array.isArray(args.deleteIds ?? []) || (args.deleteIds ?? []).length > 20 || args.shapes.length + (args.deleteIds?.length ?? 0) < 1) return null
  const safeId = id => typeof id === 'string' && /^(shape:)?[a-zA-Z0-9_-]{1,100}$/.test(id)
  if (!(args.deleteIds ?? []).every(safeId)) return null
  if (!args.shapes.every(shape => shape && Object.keys(shape).every(key => ['shapeId', '_type', 'x', 'y', 'w', 'h', 'text', 'color'].includes(key)) && safeId(shape.shapeId) && ['rectangle', 'ellipse', 'text'].includes(shape._type) && ['x','y','w','h'].every(key => typeof shape[key] === 'number' && Number.isFinite(shape[key]) && Math.abs(shape[key]) <= 5000 && (!['w','h'].includes(key) || shape[key] >= 10)) && typeof shape.text === 'string' && shape.text.length <= 1000 && (shape.color === undefined || ['black','blue','green','red','orange','yellow','violet','grey'].includes(shape.color)))) return null
  return `editor.deleteShapes(${JSON.stringify(args.deleteIds ?? [])}); ${args.shapes.map(shape => `editor.createShape(${JSON.stringify(shape)});`).join(' ')} editor.zoomToFit();`
}
const canvasSchema = { type: 'object', properties: { shapes: { type: 'array', maxItems: 20, items: { type: 'object', properties: { shapeId: {type:'string'}, _type: {type:'string',enum:['rectangle','ellipse','text']}, x:{type:'number'},y:{type:'number'},w:{type:'number'},h:{type:'number'},text:{type:'string',maxLength:1000},color:{type:'string',enum:['black','blue','green','red','orange','yellow','violet','grey']} },required:['shapeId','_type','x','y','w','h','text'],additionalProperties:false } }, deleteIds:{type:'array',items:{type:'string'},maxItems:20} },required:['shapes'],additionalProperties:false }
const buildingSchema = { type: 'object', properties: { address:{type:'string',enum:['Rijksmuseum','Gustav Mahlerlaan 10']}, presentation:{type:'string',enum:['map','table']} }, required:['address','presentation'], additionalProperties:false }

export async function viewChatRpc(proxy, session, turn, rpc) {
  if (rpc.method === 'initialize') return json(rpc, { protocolVersion: rpc.params?.protocolVersion ?? '2025-03-26', capabilities:{tools:{}},serverInfo:{name:'view_demo',version:'1'} })
  if (rpc.method === 'notifications/initialized') return {status:202,headers:{'Cache-Control':'no-store'},body:Buffer.alloc(0)}
  if (rpc.method === 'ping') return json(rpc,{})
  if (rpc.method === 'resources/list') return json(rpc,{resources:[]})
  const provider = turn.view.provider, state = session.publicServers.get(provider)
  if (rpc.method === 'tools/list') {
    const tools = provider === 'flint' ? state.tools.filter(tool => tool.name === 'create_chart_view').map(({name,description,inputSchema}) => ({name,description,inputSchema})) : [{ name:provider === 'tldraw' ? 'update_canvas' : 'show_building', description:provider === 'tldraw' ? 'Prepare additions or explicit deletions on THIS canvas. Preserve manual edits. Use new shape IDs for additions. A captured MCP exec is applied by the host after checking current context and permission.' : 'Look up one of the two real public sample addresses and prepare its map or table. Public building records cannot be changed.',inputSchema:provider === 'tldraw' ? canvasSchema : buildingSchema }]
    return json(rpc,{tools:turn.allowChanges ? tools : []})
  }
  if (rpc.method !== 'tools/call' || !turn.allowChanges || !current(session,turn)) return refuse(rpc,'This view changed or its permission ended',409)
  if (turn.status !== 'unused') return refuse(rpc,'This turn already submitted its operation. No call was repeated.',409)
  const args = rpc.params?.arguments ?? {}
  let toolName, input
  if (provider === 'flint' && rpc.params.name === 'create_chart_view') { toolName='create_chart_view';input=args }
  else if (provider === 'tldraw' && rpc.params.name === 'update_canvas') {
    const code=canvasScript(args)
    if (!code || !turn.view.canvasId) return refuse(rpc,'Use bounded drawing shapes on the attached canvas',400)
    toolName='exec';input={code,canvasId:turn.view.canvasId}
    state.permittedScripts ??= new Map();state.permittedScripts.set(turn.turnId, input)
  } else if (provider === 'buildings' && rpc.params.name === 'show_building' && Object.keys(args).every(key=>['address','presentation'].includes(key)) && ['Rijksmuseum','Gustav Mahlerlaan 10'].includes(args.address) && ['map','table'].includes(args.presentation)) { toolName=args.presentation==='map'?'render_map':'render_table' }
  else return refuse(rpc,'Unsupported view operation',400)
  turn.status='unknown'
  try {
    async function call(name, arguments_, id) {
      const saved=await proxy(provider,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:arguments_,_meta:{'ri/evaluationInvocation':id}}},session)
      const value=parseRpc(saved.body,saved.headers['Content-Type'])
      if (saved.status !== 200 || !value.result || value.result.isError || saved.body.length > 512*1024) throw new Error(value.error?.message ?? 'The service could not capture this operation')
      return value.result
    }
    if (provider==='buildings') {
      const address=args.address==='Rijksmuseum'?{postcode:'1071XX',huisnummer:1}:{postcode:'1082PP',huisnummer:10}
      const data=await call('get_building_profile',{...address,queryIntent:'Show the selected public demo building in the requested view.'},randomUUID())
      const p=data.structuredContent
      if (typeof p?.adres !== 'string' || !Number.isFinite(p.coordinaten?.lat) || !Number.isFinite(p.coordinaten?.lon)) throw new Error('No public building location was returned')
      input=toolName==='render_map'?{title:args.address,markers:[{lat:p.coordinaten.lat,lng:p.coordinaten.lon,label:p.adres,description:`Built ${p.bouwjaar}. Energy label: ${p.energielabel ?? 'none registered'}.`,type:'building'}],center:{lat:p.coordinaten.lat,lng:p.coordinaten.lon},zoom:16}:{title:args.address,columns:[{key:'address',header:'Address'},{key:'year',header:'Built'},{key:'label',header:'Energy label'}],data:[{address:p.adres,year:String(p.bouwjaar),label:p.energielabel??'None registered'}]}
    }
    if (!current(session,turn)) throw new Error('The attached view changed')
    const result=await call(toolName,input,turn.turnId)
    turn.capture={kind:'view',invocationId:turn.view.invocationId,toolName,input,result}
    turn.status='ready'
    return json(rpc,{content:[{type:'text',text:'Prepared the view operation through MCP. The host will apply this captured result only if the context and permission are still current.'}],...(provider==='tldraw'?{}:{structuredContent:result.structuredContent})})
  } catch(error) { return refuse(rpc,`${error.message}. No call was repeated.`,502) }
}
export function capturedView(session,turn,invocationId,apply=false) {
  if (turn.status !== 'ready' || turn.applied || turn.view?.invocationId !== invocationId || !current(session,turn)) return null
  if (apply) {
    const state=session.publicServers.get(turn.view.provider),view=state.views.get(invocationId)
    view.toolName=turn.capture.toolName;view.version++;turn.applied=true
  }
  return turn.capture
}
export function isPublicViewTool(provider,name) { return TOOL_NAMES[provider]?.includes(name) ?? false }
