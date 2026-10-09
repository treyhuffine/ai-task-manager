import {boundedRequestBody} from '@/lib/http';
import {verifyOwnerToken,validateRequestOrigin} from '@/lib/auth';
import {z} from 'zod/v4';
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin&&origin!==process.env.FINANCE_PUBLIC_URL)return new Response(null,{status:403});
 if(Number(request.headers.get('content-length'))>5000)return new Response(null,{status:413});
 try{validateRequestOrigin(request);const {token}=z.object({token:z.string().min(1).max(4000)}).strict().parse(JSON.parse(new TextDecoder().decode(await boundedRequestBody(request,5000))));if(!verifyOwnerToken(token))return new Response(null,{status:401});const secure=new URL(request.url).protocol==='https:'||process.env.FINANCE_PUBLIC_URL?.startsWith('https:');return Response.json({signedIn:true},{headers:{'Set-Cookie':`finance_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure?'; Secure':''}`,'Cache-Control':'no-store'}});}catch{return new Response(null,{status:400});}
}
