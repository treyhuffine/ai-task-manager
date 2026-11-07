'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { apiErrorText } from '@/lib/api/client';
import type { RiDesktop } from '@/lib/client/desktop';
import { describeHomeStatus } from '@/lib/service/home-status';
import { trpcClient } from '@/lib/trpc/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

/** The same status `ri status` prints, and what's specific to this computer (4.2). */
export function ThisComputerSection() {
  const id = useId();
  const client = useQueryClient();
  const [desktop, setDesktop] = useState<RiDesktop>();
  const [working, setWorking] = useState(false);
  const [told, setTold] = useState('');
  useEffect(() => { if (window.riDesktop?.computer) setDesktop(window.riDesktop); }, []);
  const facts = useQuery({ queryKey: ['this-computer'], queryFn: () => trpcClient.service.computerGet.query({}), refetchInterval: 5000, retry: false });
  const app = useQuery({ queryKey: ['this-computer-app'], enabled: !!desktop, queryFn: () => desktop!.computer!({ type: 'status' }), refetchInterval: 5000 });
  if (!facts.data) return <p className="text-sm text-muted-foreground">{facts.error ? apiErrorText(facts.error) : 'Checking this computer…'}</p>;
  const { status, supervised, stopped, computer, homeCommit, otherHomes, root } = facts.data;
  const lines = describeHomeStatus({ status: status as never, supervised, stopped, computer, homeCommit, now: Date.now() });
  const homeVersion = status?.release?.release.version ?? status?.version;
  const act = async (action: Parameters<NonNullable<RiDesktop['computer']>>[0]) => {
    setWorking(true); setTold('');
    try {
      const result = await desktop!.computer!(action);
      if (result.message) setTold(result.message);
      await client.invalidateQueries({ queryKey: ['this-computer'] });
      await client.invalidateQueries({ queryKey: ['this-computer-app'] });
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setWorking(false); }
  };

  return <div className="space-y-5 text-sm">
    <div className="space-y-1">
      <p className="font-medium">{root}</p>
      {app.data && <p className="text-muted-foreground">This app {app.data.appVersion}{homeVersion ? `, your Home ${homeVersion}` : ''}</p>}
    </div>
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      {lines.map(([label, value]) => <div key={`${label}:${value}`} className="contents">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className={label === 'error' ? 'text-destructive' : undefined}>{value}</dd>
      </div>)}
    </dl>
    {otherHomes.length > 0 && <div className="space-y-1"><p className="text-muted-foreground">Also on this computer</p>{otherHomes.map(home => <p key={home}>{home}</p>)}</div>}
    {desktop && app.data?.canKeepRunning && <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <Label htmlFor={`${id}-keep`}>Keep Ri running on this computer</Label>
        <p id={`${id}-keep-help`} className="text-xs text-muted-foreground">Ri starts when you log in and comes back after a crash, whether or not this window is open. Turning it off restarts Ri, which ends any running chats.</p>
      </div>
      <Switch id={`${id}-keep`} checked={app.data.keepRunning} disabled={working} aria-describedby={`${id}-keep-help`} onCheckedChange={on => void act({ type: 'keep-running', on })} />
    </div>}
    {!desktop && !supervised && <p className="text-muted-foreground">To keep this Ri running after crashes and restarts, run <code>ri start</code> on this computer.</p>}
    {desktop && <div className="space-y-2">
      <Button variant="outline" disabled={working} onClick={() => void act({ type: 'add-to-terminal' })}>Add <code className="mx-1">ri</code> to Terminal</Button>
      <p className="text-xs text-muted-foreground">Installs the <code>ri</code> command and adds it to your shell&apos;s PATH if needed.</p>
    </div>}
    {told && <p role="status">{told}</p>}
  </div>;
}
