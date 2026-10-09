'use client';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {trpcClient} from '@/lib/trpc/client';
import {Button} from '@/components/ui/button';
import {toast} from 'sonner';
import {KEY,useLocalApps} from './app-hooks';
import {AppGrantEditor} from './grant-editor';

type AppContract = Awaited<ReturnType<typeof trpcClient.localApps.describe.query>>['contract'];
export function AppSchedules({instanceId,contract}:{instanceId:string;contract:AppContract}) {
  const {data}=useLocalApps(), qc=useQueryClient();
  const [jobId,setJobId]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const actions=contract.actions.filter(action=>action.audience.includes('schedule'));
  async function save(form:HTMLFormElement) {
    if(!jobId)return;
    setBusy(true);
    try {
      const current=await trpcClient.localApps.list.query(), fields=new FormData(form);
      const grant=current.grants.findLast(item=>item.instanceId===instanceId&&item.principal.kind==='job'&&item.principal.id===jobId&&!item.revokedAt);
      if(!grant)throw new Error('Review and allow this schedule’s actions first');
      const start=String(fields.get('start')??''),end=String(fields.get('end')??'');
      if (Boolean(start) !== Boolean(end)) throw new Error('Choose both active-hours times');
      await trpcClient.localApps.schedule.mutate({revision:current.revision,schedule:{instanceId,action:String(fields.get('action')),input:JSON.parse(String(fields.get('input'))),cron:String(fields.get('cron')),timezone:String(fields.get('timezone')),activeHours:start&&end?{start,end}:null,enabled:fields.get('enabled')==='on',grantId:grant.id}});
      await qc.invalidateQueries({queryKey:KEY});setJobId(null);
    }catch(error){toast.error(error instanceof Error?error.message:'Schedule could not be saved');}finally{setBusy(false);}
  }
  return <section className="space-y-3 rounded border p-4"><h3 className="font-medium">Schedules</h3>
    <p className="text-sm text-muted-foreground">Jobs use their own reviewed permission. An overdue job runs once after the Home returns. Overlapping slots are skipped.</p>
    {data?.schedules.filter(job=>job.instanceId===instanceId).map(job=><div key={job.id} className="flex items-center gap-2 text-sm"><span className="mr-auto">{job.action} · {job.cron} · {job.enabled?'Enabled':'Disabled'}</span><Button size="sm" variant="outline" onClick={()=>setJobId(job.id)}>Edit</Button></div>)}
    {!!actions.length&&!jobId&&<Button variant="outline" onClick={()=>setJobId(crypto.randomUUID())}>New schedule</Button>}
    {jobId&&<div key={jobId} className="space-y-3"><AppGrantEditor instanceId={instanceId} principal={{kind:'job',id:jobId}}/>
      <form onSubmit={event=>{event.preventDefault();void save(event.currentTarget);}} className="space-y-3">
        <label className="block text-sm">App action<select name="action" defaultValue={data?.schedules.find(job=>job.id===jobId)?.action??actions[0]?.name} className="mt-1 w-full rounded border bg-background p-2" required>{actions.map(action=><option key={action.name} value={action.name}>{action.name}</option>)}</select></label>
        <label className="block text-sm">Action input<textarea name="input" defaultValue={JSON.stringify(data?.schedules.find(job=>job.id===jobId)?.input??actions[0]?.examples[0]?.input??{},null,2)} className="mt-1 min-h-24 w-full rounded border bg-background p-2 font-mono" required/></label>
        <label className="block text-sm">Cron<input name="cron" defaultValue={data?.schedules.find(job=>job.id===jobId)?.cron??'0 9 * * *'} className="mt-1 w-full rounded border bg-background p-2" required/></label>
        <label className="block text-sm">Timezone<input name="timezone" defaultValue={data?.schedules.find(job=>job.id===jobId)?.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone} className="mt-1 w-full rounded border bg-background p-2" required/></label>
        <div className="flex gap-3"><label className="text-sm">Active from<input name="start" type="time" className="block rounded border bg-background p-2" defaultValue={data?.schedules.find(job=>job.id===jobId)?.activeHours?.start}/></label><label className="text-sm">Active until<input name="end" type="time" className="block rounded border bg-background p-2" defaultValue={data?.schedules.find(job=>job.id===jobId)?.activeHours?.end}/></label></div>
        <label className="block text-sm"><input name="enabled" type="checkbox" defaultChecked={data?.schedules.find(job=>job.id===jobId)?.enabled??true}/> Enable schedule</label>
        <Button disabled={busy}>Save schedule</Button><Button type="button" variant="ghost" onClick={()=>setJobId(null)}>Close</Button>
      </form></div>}
  </section>;
}
