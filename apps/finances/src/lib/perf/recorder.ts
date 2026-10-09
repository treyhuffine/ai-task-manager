import fs from 'node:fs/promises';
import path from 'node:path';
import {getAppRoot} from '@/lib/config/paths';
export async function perfScope<T>(name:string,fn:()=>Promise<T>):Promise<T>{
 const started=performance.now();try{return await fn();}finally{
  const elapsedMs=Math.round(performance.now()-started);
  if(elapsedMs>250){const file=path.join(getAppRoot(),'performance.jsonl');try{const stat=await fs.stat(file).catch(()=>null);if(stat&&stat.size>1024*1024)await fs.rename(file,file+'.previous');await fs.appendFile(file,JSON.stringify({at:new Date().toISOString(),name,elapsedMs})+'\n',{mode:0o600});}catch{/* Diagnostics must not stop financial work. */}}
 }
}
