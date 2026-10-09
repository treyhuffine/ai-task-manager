import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {previewRiCapability} from './preview-ri';
it('keeps synthetic Ri previews local to their draft and deduplicates retries without real records',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ri-preview-cap-'));
  try{const context={id:randomUUID(),principal:{kind:'fixture' as const,id:'preview'},audience:'user' as const,grantRevision:0,deadline:Date.now()+3000,packageDigest:'a'.repeat(64)},signal=new AbortController().signal;
    const call={callId:randomUUID(),name:'create_task',input:{title:'Preview only'}};
    const result=previewRiCapability(path.join(root,'one'),context,call,signal);
    expect(previewRiCapability(path.join(root,'one'),context,{...call,callId:randomUUID()},signal)).toEqual(result);
    expect(previewRiCapability(path.join(root,'one'),context,{callId:randomUUID(),name:'list_tasks',input:{}},signal)).toHaveLength(2);
    expect(previewRiCapability(path.join(root,'two'),context,{callId:randomUUID(),name:'list_tasks',input:{}},signal)).toHaveLength(1);
    expect(fs.readdirSync(root)).toEqual(['one']);expect(fs.existsSync(path.join(root,'data.db'))).toBe(false);
    expect(()=>previewRiCapability(path.join(root,'one'),context,{callId:randomUUID(),name:'get_task',input:{id:randomUUID()}},signal)).toThrow(/synthetic/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
