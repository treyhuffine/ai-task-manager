/** Real HTTP and actual Home process restart, with an in-process fake provider. */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { teamTRPC } from '@/lib/spaces/remote';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { parseTeamLink } from '@/lib/team/links';
it('keeps two-member work, approval authority, stopped outcomes and native identity through an actual server restart',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ri-team-http-restart-'));
 let server:TeamProcess|undefined;
 try{
  server=await startTeamProcess(root,'Shared HTTP Home','Owner',{execution:true});
  let owner=teamTRPC(server.url,server.ownerToken);
  const invite=parseTeamLink((await owner.team.invitations.create.mutate()).link)!;
  const joined=await fetch(server.url+'/api/team/public/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:invite.secret,name:'Maya',device:{kind:'computer',name:'Second browser'}})});
  expect(joined.ok).toBe(true);const admission=await joined.json() as {token:string;member:{id:string}};
  let member=teamTRPC(server.url,admission.token);
  const chat=(await owner.workspaces.chatNewPost.mutate({ params: { id: server.workspaceId! }, body: {} })).session;
  const waitTurn=async(id:string,status:string)=>vi.waitFor(async()=>{const turn=(await member.sessions.runtimeStatusGet.query({ params: { id: chat.id } })).teamTurns!.find(turn=>turn.id===id);expect(turn?.status,JSON.stringify(turn)).toBe(status);},{timeout:10000,interval:25});
  const send = async (client: typeof owner, text: string) => {
    const id = crypto.randomUUID();
    await client.sessions.messagesPost.mutate({ params: { id: chat.id }, body: { id, content: text } });
    let turnId: string | undefined;
    await vi.waitFor(async () => { turnId = (await client.sessions.runtimeStatusGet.query({ params: { id: chat.id } })).teamTurns?.find(turn => turn.messageEventId === id)?.id; expect(turnId).toBeTruthy(); }, { timeout: 10000, interval: 25 });
    return { turnId: turnId!, messageId: id };
  };
  const first=await send(owner, 'Start work');await waitTurn(first.turnId,'done');
  const native=(await member.sessions.get.query({params:{id:chat.id}})).externalSessionId;expect(native).toBeTruthy();
  await owner.sessions.update.mutate({params:{id:chat.id},body:{permissionMode:'ask'}});
  // A fresh ordinary session applies the selected permission mode after restart.
  await server.stop();server=await startTeamProcess(root,'Shared HTTP Home','Owner',{execution:true});owner=teamTRPC(server.url,server.ownerToken);member=teamTRPC(server.url,admission.token);
  const second=await send(member, 'Ask permission');
  await vi.waitFor(async()=>expect(await owner.sessions.pendingInputGet.query({params:{id:chat.id}})).toHaveLength(1),{timeout:10000,interval:25});
  const client=await member.team.aiClients.create.mutate({name:'Untrusted assistant'});
  const refused=await fetch(server.url+'/api/trpc/sessions.pendingInputRequestIdPost',{method:'POST',headers:{authorization:'Bearer '+client.token,'content-type':'application/json',[API_PROTOCOL_HEADER]:String(API_PROTOCOL)},body:JSON.stringify({params:{id:chat.id,requestId:'http-approval'},body:{allow:true}})});
  expect(refused.status).toBe(403);
  const testConfig = JSON.parse(fs.readFileSync(path.join(root, '.config', 'config.json'), 'utf8'));
  const credential = sessionCredential(chat.id, testConfig.localToken)!;
  const headers = { authorization: 'Bearer ' + admission.token, [SESSION_CREDENTIAL_HEADER]: credential, 'content-type': 'application/json', [API_PROTOCOL_HEADER]: String(API_PROTOCOL) };
  const agentAnswer = await fetch(server.url + '/api/trpc/sessions.pendingInputRequestIdPost', { method: 'POST', headers, body: JSON.stringify({ params: { id: chat.id, requestId: 'http-approval' }, body: { allow: true } }) });
  expect(agentAnswer.status).toBe(403);
  expect(await agentAnswer.text()).toMatch(/person|cannot perform/);

  expect(await owner.sessions.pendingInputGet.query({params:{id:chat.id}})).toHaveLength(1);
  expect(await owner.sessions.pendingInputRequestIdPost.mutate({params:{id:chat.id,requestId:'http-approval'},body:{allow:true}})).toEqual({ok:true});await waitTurn(second.turnId,'done');
  const held=await send(member, 'Keep working');await waitTurn(held.turnId,'running');
  await owner.sessions.interruptPost.mutate({ params: { id: chat.id }, body: {} });await waitTurn(held.turnId,'cancelled');
  const crash=await send(member, 'Keep working until restart');await waitTurn(crash.turnId,'running');
  const authors=(await member.sessions.eventsGet.query({params:{id:chat.id}})).filter(event=>event.source==='user').map(event=>[event.id,event.authorMemberId]);
  await server.stop();server=await startTeamProcess(root,'Shared HTTP Home','Owner',{execution:true});member=teamTRPC(server.url,admission.token);
  const persisted = new Database(path.join(root, 'data.db'), { readonly: true });
  try {
    const runs = persisted.prepare('SELECT status FROM runs WHERE chat_session_id = ?').all(chat.id) as { status: string }[];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every(run => !['running', 'queued'].includes(run.status))).toBe(true);
  } finally { persisted.close(); }
  await waitTurn(crash.turnId,'interrupted');await waitTurn(first.turnId,'done');await waitTurn(held.turnId,'cancelled');
  expect((await member.sessions.eventsGet.query({params:{id:chat.id}})).filter(event=>event.source==='user').map(event=>[event.id,event.authorMemberId])).toEqual(authors);
  const resumed=await send(member, 'Continue after restart');await waitTurn(resumed.turnId,'done');
  expect(await member.sessions.get.query({params:{id:chat.id}})).toMatchObject({externalSessionId:native,createdByMemberId:server.ownerId});
  const messages=await member.sessions.eventsGet.query({params:{id:chat.id}});expect(messages.find(event=>event.id===resumed.messageId)?.authorMemberId).toBe(admission.member.id);
  expect((await member.sessions.runtimeStatusGet.query({ params: { id: chat.id } })).teamTurns!).toHaveLength(5);
  owner = teamTRPC(server.url, server.ownerToken);
  const ownerToken = server.ownerToken, workspaceId = server.workspaceId;
  await owner.team.ai.setEnabled.mutate({ enabled: false });
  await server.stop(); server = await startTeamProcess(root, 'Shared HTTP Home', 'Owner', { execution: true });
  expect(server.ownerToken).toBe(ownerToken); expect(server.workspaceId).toBe(workspaceId);
  owner = teamTRPC(server.url, server.ownerToken);
  expect((await owner.team.ai.status.query()).enabled).toBe(false);
  expect((await owner.sessions.get.query({ params: { id: chat.id } })).permissionMode).toBe('ask');
 }finally{await server?.stop();fs.rmSync(root,{recursive:true,force:true});}
},60000);
