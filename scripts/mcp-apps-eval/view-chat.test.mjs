import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { admitViewTurn, canvasScript, capturedView, viewChatRpc } from './view-chat.mjs'
import { publicRequestAllowed, createPublicProxy } from './public-servers.mjs'
const result = value => ({status:200,headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,result:value}))})
function fixture(provider='flint') {
 const invocationId=randomUUID(),state={views:new Map([[invocationId,{toolName:provider==='tldraw'?'exec':'create_chart_view',version:2,pending:0,unknown:false,canvasId:provider==='tldraw'?'owned':undefined}]]),tools:[{name:'create_chart_view',inputSchema:{type:'object'}}],canvases:new Set(['owned']),checkpoints:new Set()}
 const session={calls:0,publicServers:new Map([[provider,state]])},context={kind:'public',app:provider==='flint'?'Flint charts':provider==='tldraw'?'tldraw':'Building explorer',invocationId,update:{version:2}}
 const view=admitViewTurn(session,context),turn={view,turnId:randomUUID(),allowChanges:true,status:'unused'}
 return {session,state,context,turn}
}
test('admits only the originating public view and rejects stale, pending or cross-app grants',()=>{
 const {session,state,context}=fixture()
 assert(admitViewTurn(session,context));assert.equal(admitViewTurn(session,{...context,kind:'account'}),null);assert.equal(admitViewTurn(session,{...context,app:'tldraw'}),null);assert.equal(admitViewTurn(session,{...context,invocationId:randomUUID()}),null)
 state.views.get(context.invocationId).pending++;assert.equal(admitViewTurn(session,context),null)
})
test('captures a chart once, strips private metadata for the model, and applies without another call',async()=>{
 const {session,state,context,turn}=fixture();let calls=0
 const proxy=async()=>{calls++;return result({content:[{type:'text',text:'Chart'}],structuredContent:{title:'Line'},_meta:{private:'ONLY UI'}})}
 const rpc={id:1,method:'tools/call',params:{name:'create_chart_view',arguments:{data:{values:[{x:1,y:2}]},chart_spec:{chartType:'Line Chart',encodings:{}}}}}
 const reply=await viewChatRpc(proxy,session,turn,rpc);assert.equal(reply.status,200);assert(!reply.body.includes('ONLY UI'));assert.equal(turn.status,'ready')
 const capture=capturedView(session,turn,context.invocationId);assert.equal(capture.result._meta.private,'ONLY UI');assert.equal(capturedView(session,turn,randomUUID()),null)
 assert(capturedView(session,turn,context.invocationId,true));assert.equal(capturedView(session,turn,context.invocationId,true),null)
 assert.equal((await viewChatRpc(proxy,session,turn,rpc)).status,409);assert.equal(calls,1);assert.equal(state.views.get(context.invocationId).version,3)
})
test('building view uses a real lookup before rendering a bounded deterministic map or table',async()=>{
 const {session,context,turn}=fixture('buildings');const calls=[]
 const proxy=async(_name,rpc)=>{calls.push(rpc);return result(rpc.params.name==='get_building_profile'?{structuredContent:{adres:'Gustav Mahlerlaan 10',bouwjaar:2014,energielabel:'A',coordinaten:{lat:52.33,lon:4.87}}}:{content:[{type:'text',text:'Table'}]})}
 const reply=await viewChatRpc(proxy,session,turn,{id:1,method:'tools/call',params:{name:'show_building',arguments:{address:'Gustav Mahlerlaan 10',presentation:'table'}}})
 assert.equal(reply.status,200);assert.deepEqual(calls.map(r=>r.params.name),['get_building_profile','render_table']);assert.equal(calls[1].params.arguments.data[0].year,'2014');assert.equal(capturedView(session,turn,context.invocationId).toolName,'render_table')
})
test('canvas changes encode structured shapes as literals and cannot submit arbitrary executable code',async()=>{
 const {session,state,turn,context}=fixture('tldraw'),shapes=[{shapeId:'done',_type:'rectangle',x:500,y:100,w:200,h:120,text:'\";window.fetch(\"https://evil.test\")//',color:'green'}]
 const code=canvasScript({shapes});assert(code.includes(JSON.stringify(shapes[0])));assert.equal(canvasScript({code:'alert(1)',shapes}),null);assert.equal(canvasScript({shapes:[{...shapes[0],x:Infinity}]}),null)
 let call;await viewChatRpc(async(_p,rpc)=>{call=rpc;return result({structuredContent:{canvasId:'owned'}})},session,turn,{id:1,method:'tools/call',params:{name:'update_canvas',arguments:{shapes}}})
 assert.equal(call.params.arguments.canvasId,'owned');assert(publicRequestAllowed('tldraw',call,state));assert.equal(publicRequestAllowed('tldraw',{...call,params:{...call.params,arguments:{...call.params.arguments,code:'alert(1)'}}},state),false)
 state.views.get(context.invocationId).version++;assert.equal(capturedView(session,turn,context.invocationId,true),null)
})
test('a canvas save invalidates an in-flight update before it can be applied',async()=>{
 const {session,state,turn,context}=fixture('tldraw');state.deliveries=new Map();state.requestId=0
 const proxy=createPublicProxy(async(_url,rpc)=>({status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:{content:[]}}))}))
 let release;const wait=new Promise(resolve=>release=resolve)
 const slow=createPublicProxy(async(_url,rpc)=>{await wait;return {status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:{content:[]}}))}})
 const pending=slow('tldraw',{id:1,method:'tools/call',params:{name:'save_checkpoint',arguments:{canvasId:'owned',checkpointId:'owned_cp',shapesJson:'[]'},_meta:{'ri/evaluationInvocation':randomUUID()}}},session)
 assert.equal(admitViewTurn(session,context),null);release();await pending;assert.equal(capturedView(session,turn,context.invocationId),null)
 assert.equal(state.views.get(context.invocationId).pending,0);assert.equal(state.views.get(context.invocationId).version,3)
 await proxy('tldraw',{id:1,method:'tools/call',params:{name:'save_checkpoint',arguments:{canvasId:'owned',checkpointId:'owned_cp',shapesJson:'[]'},_meta:{'ri/evaluationInvocation':randomUUID()}}},session);assert.equal(state.views.get(context.invocationId).version,3)
})
