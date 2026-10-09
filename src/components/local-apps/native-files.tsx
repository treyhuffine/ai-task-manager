'use client';
import {useEffect, useRef, useState} from 'react';
import type {FileCapabilities} from '@ri/app-kit/contract';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';

type Policy=NonNullable<FileCapabilities['select']>;
type SelectedFile={name:string;mimeType:string;base64:string};
type Pending={policy:Policy;finish:(file:SelectedFile|null)=>void;reject:(error:Error)=>void};
export function useNativeFiles() {
  const [pending,setPending]=useState<Pending|null>(null);
  const [error,setError]=useState<string|null>(null);
  const active=useRef<Pending|null>(null);
  useEffect(()=>()=>{active.current?.reject(new Error('The app view closed'));active.current=null;}, []);
  const select=(policy:Policy,signal:AbortSignal)=>new Promise<SelectedFile|null>((resolve,reject)=>{
    if(signal.aborted)return reject(new Error('File selection cancelled'));
    if(active.current)return reject(new Error('A file selection is already open'));
    setError(null);
    let settled=false;
    const finish=(file:SelectedFile|null)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);active.current=null;setPending(null);resolve(file);};
    const cancel=()=>finish(null);
    const request={policy,finish,reject:(error:Error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);active.current=null;reject(error);}};
    active.current=request;
    signal.addEventListener('abort',cancel,{once:true});
    setPending(request);
  });
  const picker=<Dialog open={!!pending} onOpenChange={open=>{if(!open)pending?.finish(null);}}><DialogContent><DialogHeader><DialogTitle>Select a file for this app</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Only the file you choose is shared. Maximum {Math.ceil((pending?.policy.maxBytes??0)/1024)} KiB.</p><input aria-label="Select app file" type="file" accept={pending?.policy.mimeTypes.join(',')} onChange={async event=>{
    const file=event.target.files?.[0],request=pending;
    if(!file||!request)return;
    try{
      if(file.size>request.policy.maxBytes)throw new Error('This file exceeds the app limit');
      const mimeType=file.type || (/\.csv$/i.test(file.name)?'text/csv':/\.txt$/i.test(file.name)?'text/plain':'application/octet-stream');
      if(!request.policy.mimeTypes.includes(mimeType as Policy['mimeTypes'][number]))throw new Error('This file type is unavailable for this app');
      const bytes=new Uint8Array(await file.arrayBuffer());
      let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
      if(active.current!==request)return;
      request.finish({name:file.name.slice(0,200),mimeType,base64:btoa(binary)});
    }catch(error){setError(error instanceof Error?error.message:'File selection failed');}
  }}/>{error&&<p role="alert" className="text-sm">{error}</p>}<Button variant="outline" onClick={()=>pending?.finish(null)}>Cancel</Button></DialogContent></Dialog>;
  return {select,picker};
}

/** Embedded bytes only. A resource URI is a suggested name, never a fetch or local path. */
export async function downloadAppFile(contents:unknown[],policy:Policy,signal:AbortSignal,reauthorize:()=>Promise<unknown>) {
  if(contents.length!==1)throw new Error('Download one file at a time');
  const item=contents[0] as {type?:string;resource?:{uri?:string;mimeType?:string;text?:string;blob?:string}};
  if(item?.type!=='resource'||!item.resource)throw new Error('Only embedded file downloads are supported');
  const resource=item.resource,mimeType=resource.mimeType;
  if(!mimeType||!policy.mimeTypes.includes(mimeType as Policy['mimeTypes'][number]))throw new Error('This download type is unavailable');
  let bytes:Uint8Array<ArrayBuffer>;
  if(typeof resource.text==='string' && resource.blob===undefined)bytes=new TextEncoder().encode(resource.text);
  else if(typeof resource.blob==='string' && resource.text===undefined){
    if(resource.blob.length>Math.ceil(policy.maxBytes/3)*4||! /^[A-Za-z0-9+/]*={0,2}$/.test(resource.blob))throw new Error('Invalid or oversized file download');
    bytes=Uint8Array.from(atob(resource.blob),char=>char.charCodeAt(0));
  }else throw new Error('Invalid file download');
  if(bytes.byteLength>policy.maxBytes)throw new Error('This download exceeds the app limit');
  const name=decodeURIComponent((resource.uri??'app-export').split('/').at(-1)??'app-export').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,150)||'app-export';
  if(signal.aborted||!window.confirm(`Download ${name} from this app?`))throw new Error('Download cancelled');
  await reauthorize();if(signal.aborted)throw new Error('Download cancelled');
  const url=URL.createObjectURL(new Blob([bytes],{type:mimeType})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10_000);
}
