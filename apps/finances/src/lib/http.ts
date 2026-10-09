import {OperationError} from '@/lib/server/operation';
export async function boundedRequestBody(request:Request,maximum:number){
 if(Number(request.headers.get('content-length'))>maximum)throw new OperationError(413,{message:'Request exceeded its byte limit'});
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let total=0;
 for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>maximum){await reader.cancel();throw new OperationError(413,{message:'Request exceeded its byte limit'});}chunks.push(part.value);}
 return new Uint8Array(Buffer.concat(chunks));
}
