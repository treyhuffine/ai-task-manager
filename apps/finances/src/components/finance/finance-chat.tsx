'use client';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {trpc,trpcClient} from '@/lib/trpc/client';
export function FinanceChat({viewId}:{viewId:string}){
 const [sessionId,setSessionId]=useState<string|null>(null);
 const [includeEvidence,setIncludeEvidence]=useState(false);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const messages=useQuery({...trpc.app.messages.queryOptions({sessionId:sessionId??''}),enabled:!!sessionId});
 async function open(){
  try{const result=await trpcClient.finance.openChat.mutate({viewId,includeEvidence,allowEdits:false});setSessionId(result.sessionId);}
  catch(e){setError(e instanceof Error?e.message:'Could not open conversation');}
 }
 async function send(e:React.FormEvent){
  e.preventDefault();if(!sessionId||!message.trim())return;setBusy(true);setError('');
  try{await trpcClient.app.ask.mutate({sessionId,message,requestId:crypto.randomUUID()});setMessage('');await messages.refetch();}
  catch(e){setError(e instanceof Error?e.message:'The reply could not finish');}
  finally{setBusy(false);}
 }
 return <details className="mt-6 rounded-xl border border-border p-4">
  <summary className="text-sm font-medium">Chat about this view</summary>
  <p className="my-3 text-xs text-muted-foreground">This app uses your selected subscription harness. The conversation saves its history here. Budget changes remain proposals until you apply them.</p>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeEvidence} onChange={e=>setIncludeEvidence(e.target.checked)}/>Include selected receipts and evidence</label>
  <Button size="sm" className="my-3" disabled={busy} onClick={()=>void open()}>{sessionId?'Update evidence access':'Open conversation'}</Button>
  {sessionId&&<>
   <div role="log" className="max-h-96 space-y-3 overflow-y-auto">{messages.data?.messages.map(m=><article key={m.id} className="rounded border border-border p-3 text-sm"><strong className="text-xs text-muted-foreground">{m.role==='user'?'You':'AI explanation'}</strong>{m.asOf&&<p className="mt-1 text-xs text-muted-foreground">Results as of {new Date(m.asOf).toLocaleString()}</p>}<p className="mt-2 whitespace-pre-wrap">{m.content}</p></article>)}</div>
   <form className="mt-4 space-y-2" onSubmit={e=>void send(e)}>
    <label className="text-xs">Finance question<textarea className="mt-1 block min-h-20 w-full rounded border border-border bg-background p-3 text-sm" maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)}/></label>
    <Button disabled={busy||!message.trim()} type="submit">{busy?'Reading selected results...':'Send'}</Button>
   </form>
  </>}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 </details>;
}
