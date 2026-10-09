import { managedMode, authenticateManaged } from '@/lib/local-app/managed';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {uuidv7} from 'uuidv7';
import {getConfigDir,publicBaseUrl} from '@/lib/config/paths';
import {getDb} from '@/lib/db';
import * as s from '@/lib/db/schema';
import {financeOwner,grantFinance,type FinancePrincipal} from '@/lib/db/finance-queries';
import {OperationError} from '@/lib/server/operation';
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
export function ownerToken(){const file=path.join(getConfigDir(),'owner.key');try{return fs.readFileSync(file,'utf8').trim();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const token='finance_owner_'+randomBytes(32).toString('base64url');try{fs.writeFileSync(file,token,{mode:0o600,flag:'wx'});return token;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;return fs.readFileSync(file,'utf8').trim();}}}
export function verifyOwnerToken(token:string){const expected=Buffer.from(hash(ownerToken())),actual=Buffer.from(hash(token));return timingSafeEqual(expected,actual);}
export function authenticateToken(token:string):FinancePrincipal|null{
 if(!token||token.length>4000)return null;
 if(managedMode())return authenticateManaged(token);
 if(verifyOwnerToken(token))return financeOwner;
 const client=getDb().select().from(s.financeClients).where(eq(s.financeClients.tokenHash,hash(token))).get();
 return client&&!client.revoked?{id:'client:'+client.id,owner:false}:null;
}
export function requestToken(request:Request){const bearer=request.headers.get('authorization');if(bearer?.startsWith('Bearer '))return bearer.slice(7);const cookie=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('finance_session='));return cookie?.slice('finance_session='.length)??'';}
export function validateRequestOrigin(request:Request){
 const host=new URL('http://'+(request.headers.get('host')??new URL(request.url).host)).hostname;
 const hosts=new Set(['localhost','127.0.0.1','[::1]',...(process.env.FINANCE_ALLOWED_HOSTS??'').split(',').filter(Boolean),...(publicBaseUrl()?[new URL(publicBaseUrl()!).hostname]:[])]);
 if(!hosts.has(host))throw new OperationError(403,{message:'This host has not been configured for finance access'});
 const origin=request.headers.get('origin');
 if(origin&&!([new URL(request.url).origin,publicBaseUrl()].filter(Boolean).includes(origin)))throw new OperationError(403,{message:'Cross-origin finance requests are not allowed'});
}
export function requestPrincipal(request:Request){validateRequestOrigin(request);return managedMode()?authenticateManaged(requestToken(request),request.headers.get('x-app-invocation-ticket')):authenticateToken(requestToken(request));}

export function requireOwner(request:Request){const p=requestPrincipal(request);if(!p?.owner)throw new OperationError(401,{message:'Sign in to this finance app'});return p;}
export function createClientKey(input:{label:string;accountIds:string[];operations:('read'|'write'|'sync'|'evidence')[]}){
 const id=uuidv7(),token='finance_client_'+randomBytes(32).toString('base64url');
 return getDb().transaction(db=>{db.insert(s.financeClients).values({id,label:input.label,tokenHash:hash(token),revoked:false}).run();grantFinance(financeOwner,'client:'+id,input.accountIds,input.operations);return {id,token};});
}
export function listClientKeys(){return getDb().select({id:s.financeClients.id,label:s.financeClients.label,revoked:s.financeClients.revoked,createdAt:s.financeClients.createdAt}).from(s.financeClients).limit(100).all();}
export function revokeClientKey(id:string){getDb().transaction(db=>{db.update(s.financeClients).set({revoked:true}).where(eq(s.financeClients.id,id)).run();db.update(s.financeGrants).set({revoked:true}).where(eq(s.financeGrants.principal,'client:'+id)).run();});}
