import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {z} from 'zod/v4';
import {AppError,targetSchema} from '@ri/app-kit/contract';
import {getBundledLocalAppsCatalogDir} from '@/lib/config/paths';
export const catalogEntrySchema=z.object({
  formatVersion:z.literal(1),packageId:z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(64),version:z.string().regex(/^\d+\.\d+\.\d+$/),
  name:z.string().min(1).max(100),description:z.string().min(1).max(1000),source:z.string().min(1).max(500),license:z.string().min(1).max(100),
  hostApi:z.literal(1),runtime:z.enum(['static','ri-ipc-v1','mcp-http-v1']),target:targetSchema.nullable(),artifactDigest:z.string().regex(/^[a-f0-9]{64}$/),archiveDigest:z.string().regex(/^[a-f0-9]{64}$/),
  capabilities:z.array(z.string().max(100)).max(100),
  demo:z.object({heading:z.string().max(100),caption:z.string().max(500),columns:z.array(z.string().max(80)).min(1).max(6),rows:z.array(z.array(z.string().max(100)).max(6)).max(20)}).strict(),
}).strict().superRefine((entry,ctx)=>{if(entry.demo.rows.some(row=>row.length!==entry.demo.columns.length))ctx.addIssue({code:'custom',message:'Demo columns and rows differ'});});
export async function archiveDigest(file:string){
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>512*1024*1024)throw new AppError('invalid_input','Invalid catalog artifact');
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
export async function listCatalog(){
  const root=getBundledLocalAppsCatalogDir(), files=await fs.readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  if(files.filter(file=>file.endsWith('.json')).length>20)throw new AppError('invalid_input','The included app catalog exceeds its limit');
  const entries:z.infer<typeof catalogEntrySchema>[]=[];
  for(const file of files.filter(file=>file.endsWith('.json')).sort()){
    const full=path.join(root,file),stat=await fs.lstat(full);
    if(!stat.isFile()||stat.size>32*1024)throw new AppError('invalid_input','Invalid catalog metadata');
    const entry=catalogEntrySchema.parse(JSON.parse(await fs.readFile(full,'utf8')));
    if(file!==entry.packageId+'.json'||entries.some(other=>other.packageId===entry.packageId))throw new AppError('invalid_input','Invalid catalog identity');
    entries.push(entry);
  }
  return entries;
}
export async function catalogArtifact(packageId:string){
  const entry=(await listCatalog()).find(entry=>entry.packageId===packageId);
  if(!entry)throw new AppError('not_found','This included app is unavailable');
  const file=path.join(getBundledLocalAppsCatalogDir(),entry.packageId+'.tar.gz');
  if(await archiveDigest(file)!==entry.archiveDigest)throw new AppError('invalid_input','The included app artifact changed. Reinstall the runtime catalog');
  return {entry,file};
}
