import { invocationTicket } from '@/lib/local-app/managed';
import {randomUUID} from 'node:crypto';
import {getBrokerConfig} from './config';
import {capabilitiesSchema,connectorCallSchema,brokerResultSchema,type ConnectorOperation} from './contracts';
export class ConnectorUnavailable extends Error{constructor(readonly code:string,message:string){super(message);}}
function rejectCredentials(data:unknown,depth=0){
 if(depth>40)throw new ConnectorUnavailable('invalid_response','Connector response exceeds its structural limit');
 if(data&&typeof data==='object')for(const [key,value] of Object.entries(data)){
  if(/^(accesstoken|refreshtoken|clientsecret|authorization|cookie|secret|privatekey|homebearer|bearertoken)$/.test(key.replace(/[_-]/g,'').toLowerCase()))throw new ConnectorUnavailable('invalid_response','Connector response contained a credential');
  rejectCredentials(value,depth+1);
 }
}
async function request(suffix:string,body?:unknown){
 const config=getBrokerConfig();if(!config)throw new ConnectorUnavailable('broker_unavailable','Ri connector access has not been configured. Manual records and CSV import are available.');
 let response:Response;
 try{response=await fetch(config.url+suffix,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+config.token,...(invocationTicket()?{'x-app-invocation-ticket':invocationTicket()!}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new ConnectorUnavailable('broker_unavailable','The connector broker is unavailable. Cached finance records remain available.');}

 const reader=response.body?.getReader();if(!reader)throw new ConnectorUnavailable('invalid_response','Empty connector response');
 const chunks:Uint8Array[]=[];let length=0;
 for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>20*1024*1024){await reader.cancel();throw new ConnectorUnavailable('invalid_response','Connector response exceeded its limit');}chunks.push(part.value);}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));rejectCredentials(data);if(!response.ok){const error=brokerResultSchema.safeParse(data);if(error.success&&!error.data.ok)throw new ConnectorUnavailable(error.data.code,error.data.message);throw new ConnectorUnavailable([401,403].includes(response.status)?'auth_required':'broker_unavailable','The connector broker is unavailable or this grant expired.');}return data;
}
export async function connectorCapabilities(){return capabilitiesSchema.parse(await request('/capabilities'));}
export async function callConnector(connectionId:string,operation:ConnectorOperation,input:Record<string,unknown>,requestId:string=randomUUID()):Promise<unknown>{
 const requestBody=connectorCallSchema.parse({version:1,requestId,connectionId,operation,input});
 const caps=await connectorCapabilities();
 if(!caps.operations.includes(operation)||!caps.connections.some(c=>c.id===connectionId&&c.status==='active'))throw new ConnectorUnavailable('grant_required','This connection or operation is outside the plugin grant.');
 const response=brokerResultSchema.parse(await request('/call',requestBody));
 if(!response.ok)throw new ConnectorUnavailable(response.code,response.message);return response.result;
}
