import { managedMode, managedBroker } from '@/lib/local-app/managed';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {z} from 'zod/v4';
import {getConfigDir} from '@/lib/config/paths';
const file=()=>path.join(getConfigDir(),'connector-broker.json');
function key(){const p=path.join(getConfigDir(),'broker-seal.key');try{return fs.readFileSync(p);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const k=randomBytes(32);fs.writeFileSync(p,k,{mode:0o600,flag:'wx'});return k;}}
export function saveBrokerConfig(input:{url:string;token:string}|null){
 if(managedMode())throw new Error('Managed broker credentials are supplied only by the host');
 if(!input){fs.rmSync(file(),{force:true});return;}
 const url=new URL(input.url);
 if(url.username||url.password||url.hash||url.search||!((url.protocol==='https:')||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Use an HTTPS broker endpoint or local loopback HTTP');
 if(input.token.length<16||input.token.length>4000)throw new Error('A scoped plugin credential is required');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),nonce),sealed=Buffer.concat([cipher.update(input.token,'utf8'),cipher.final()]);
 const value={url:url.href.replace(/\/$/,''),nonce:nonce.toString('base64'),sealed:sealed.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
 const temporary=file()+'.'+randomBytes(8).toString('hex');fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file());
}
export function getBrokerConfig(){
 if(managedMode())return managedBroker();
 if(!fs.existsSync(file()))return null;
 const v=z.object({url:z.url(),nonce:z.string(),sealed:z.string(),tag:z.string()}).strict().parse(JSON.parse(fs.readFileSync(file(),'utf8')));
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(v.nonce,'base64'));decipher.setAuthTag(Buffer.from(v.tag,'base64'));
 return {url:v.url,token:Buffer.concat([decipher.update(Buffer.from(v.sealed,'base64')),decipher.final()]).toString('utf8')};
}
export function publicBrokerConfig(){const c=getBrokerConfig();return {configured:!!c,url:c?.url??null};}
