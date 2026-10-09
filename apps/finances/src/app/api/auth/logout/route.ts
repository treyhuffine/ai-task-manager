import {requireOwner} from '@/lib/auth';
export async function POST(request:Request){try{requireOwner(request);return Response.json({signedOut:true},{headers:{'Set-Cookie':'finance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'}});}catch{return new Response(null,{status:403});}}
