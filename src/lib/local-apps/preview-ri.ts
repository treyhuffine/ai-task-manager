import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod/v4';
import {AppError,type InvocationContext} from '@ri/app-kit/contract';
import type {CapabilityCall} from '@ri/app-kit/runtime';
const record=z.object({id:z.string().uuid(),title:z.string().max(500),body:z.string().max(64000),status:z.literal('todo'),createdAt:z.string(),updatedAt:z.string()}).strict();
const registry=z.object({formatVersion:z.literal(1),tasks:z.array(record).max(100),notes:z.array(record).max(100)}).strict();
/** Synthetic capabilities only. This module never imports Ri's record queries or harness. */
export function previewRiCapability(dataDir:string,context:InvocationContext,call:CapabilityCall,signal:AbortSignal){
  if(signal.aborted)throw new AppError('interrupted','Preview capability cancelled');
  if(call.name==='ai_text'){const {prompt}=z.object({prompt:z.string().min(1).max(16000)}).strict().parse(call.input);return {text:'Fictional preview analysis of supplied text: '+prompt.slice(0,1000)};}
  const file=path.join(dataDir,'ri-fixtures.json'),stamp='2026-10-07T12:00:00.000Z';
  let state:z.infer<typeof registry>;
  try{if(fs.statSync(file).size>2*1024*1024)throw new Error('Oversized fixtures');state=registry.parse(JSON.parse(fs.readFileSync(file,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new AppError('app_failed','Preview fixtures need repair');state={formatVersion:1,tasks:[{id:'00000000-0000-4000-8000-000000000001',title:'Fictional follow-up',body:'Synthetic preview task',status:'todo',createdAt:stamp,updatedAt:stamp}],notes:[{id:'00000000-0000-4000-8000-000000000002',title:'Fictional note',body:'Synthetic preview note',status:'todo',createdAt:stamp,updatedAt:stamp}]};}
  const type=call.name.endsWith('task')||call.name.endsWith('tasks')?'tasks':'notes';
  if(call.name==='get_task'||call.name==='get_note'){const {id}=z.object({id:z.string().uuid()}).strict().parse(call.input),result=state[type].find(row=>row.id===id);if(!result)throw new AppError('not_found','That synthetic preview record does not exist');return result;}
  if(call.name==='list_tasks'||call.name==='list_notes'){const input=z.object({limit:z.number().int().min(1).max(100).optional(),offset:z.number().int().min(0).max(10000).optional()}).passthrough().parse(call.input);return state[type].slice(input.offset??0,(input.offset??0)+(input.limit??50));}
  if(call.name==='create_task'||call.name==='create_note'){
    const input=z.object({title:z.string().max(500).optional(),body:z.string().max(64000).optional(),description:z.string().max(4000).optional()}).passthrough().parse(call.input);
    const hash=createHash('sha256').update(JSON.stringify([context.id,context.principal,call.name,input])).digest('hex'),id=`${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const existing=state[type].find(row=>row.id===id);if(existing)return existing;
    if(state[type].length>=100)throw new AppError('busy','The preview fixture record limit was reached');
    const row={id,title:input.title??'Fictional note',body:input.body??input.description??'',status:'todo' as const,createdAt:stamp,updatedAt:stamp};state[type].push(row);registry.parse(state);
    fs.mkdirSync(dataDir,{recursive:true,mode:0o700});const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(state),{mode:0o600});fs.renameSync(temporary,file);return row;
  }
  throw new AppError('unsupported','This Ri capability has no preview fixture');
}
