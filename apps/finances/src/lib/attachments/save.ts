import fs from 'node:fs/promises';
import path from 'node:path';
import {uuidv7} from 'uuidv7';
import {ensureAttachmentsDir,getAttachmentsDir} from '@/lib/config/paths';
import type {Attachment} from '@/db/types';
export function attachmentPath(fileName:string){if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(fileName))throw new Error('Invalid attachment name');return path.join(getAttachmentsDir(),fileName);}
export async function saveAttachment(input:{data:Buffer|Uint8Array;originalName:string;mimeType?:string|null}):Promise<Attachment>{
 const mimeType=input.mimeType??'text/plain';const ext=({'application/pdf':'pdf','text/plain':'txt','text/html':'html'} as Record<string,string>)[mimeType];
 if(!ext||input.data.length>5*1024*1024)throw new Error('Unsupported or oversized evidence attachment');
 ensureAttachmentsDir();const fileName=uuidv7()+'.'+ext;await fs.writeFile(attachmentPath(fileName),input.data,{mode:0o600,flag:'wx'});
 return {fileName,originalName:input.originalName.slice(0,300),mimeType,size:input.data.length,uploadedAt:new Date().toISOString()};
}
