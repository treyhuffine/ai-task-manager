import {spawn} from 'node:child_process';
import {z} from 'zod/v4';
import {withFinanceExtractionProfile,UnsupportedFinanceExtraction} from './finance-isolation';
import {redact} from './redaction';
import {getFinanceAiSettings} from '@/lib/db/app-queries';
export async function runHarnessJson<T>(input:{label:string;tier?:string;maxTurns?:number;timeoutSec?:number;system:string;prompt:string;schema:z.ZodType<T>;shape:string;financeExtraction?:boolean}):Promise<T>{
 const harness=getFinanceAiSettings().harness;
 if(harness!=='claude')throw new UnsupportedFinanceExtraction('This app currently qualifies Claude subscription calls on macOS. Select manual review for other harnesses.');
 return withFinanceExtractionProfile(harness,async profile=>{
  const shape=JSON.parse(input.shape);delete shape.$schema;
  const raw=await new Promise<string>((resolve,reject)=>{
   const child=spawn(profile.command,[...profile.extraArgs,'--print','--output-format','json','--max-turns',String(Math.max(2,Math.min(4,input.maxTurns??2))),'--system-prompt',input.system,'--json-schema',JSON.stringify(shape)],{cwd:profile.cwd,env:{PATH:'/usr/bin:/bin',NODE_ENV:'production'},stdio:['pipe','pipe','pipe']});
   let output='',error='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('The subscription request timed out'));},(input.timeoutSec??90)*1000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2*1024*1024){child.kill('SIGKILL');reject(new Error('Subscription output exceeded its limit'));}});
   child.stderr.on('data',chunk=>{error=(error+chunk).slice(-16000);});
   child.on('error',e=>{clearTimeout(timer);reject(new Error(redact(e.message)));});
   child.on('close',code=>{clearTimeout(timer);if(code!==0){let detail='';try{const response=JSON.parse(output);detail=String(response.subtype??'')+' '+(typeof response.result==='string'?response.result:'');}catch{}reject(new Error(redact(detail.trim()||error)||'The subscription request failed'));}else resolve(output);});
   child.stdin.end(input.prompt);
  });
  const response=JSON.parse(raw);
  if(response.is_error)throw new Error(redact(String(response.result??'The subscription request failed')));
  const value=response.structured_output??(typeof response.result==='string'?JSON.parse(response.result):response.result);
  return input.schema.parse(value);
 });
}
