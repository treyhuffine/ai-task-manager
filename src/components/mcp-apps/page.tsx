'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MessageCircle, Settings2 } from 'lucide-react';
import { trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { Button } from '@/components/ui/button';
import { LibraryChat } from '@/components/local-apps/library-chat';
import { ConnectedView } from './view';

type App = RouterOutputs['connectedApps']['catalog'][number];
type Tool = App['tools'][number];
export function ConnectedAppPage({serverId, navigate, resultId}: {serverId: string; navigate: (route: string) => void; resultId?: string}) {
  const catalog = useQuery({queryKey: ['connected-app-catalog'], queryFn: () => trpcClient.connectedApps.catalog.query(), staleTime: 0});
  const app = catalog.data?.find(item => item.id === serverId);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [chat, setChat] = useState(false);
  if (!app) return <div className="space-y-3 p-6 text-sm"><Button variant="ghost" onClick={() => navigate('')}><ArrowLeft size={14}/>Apps</Button><p>{catalog.error?.message ?? (catalog.isPending ? 'Loading app…' : 'This connection does not currently advertise an interactive app.')}</p></div>;
  const accounts = catalog.data?.filter(candidate => app.providerId ? candidate.providerId === app.providerId : candidate.id === app.id) ?? [];
  const selected = captureId ?? (resultId && app.recent.some(item => item.id === resultId) ? resultId : app.recent[app.recent.length - 1]?.id);
  const recent = app.recent.find(item => item.id === selected);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
      <Button variant="ghost" size="icon-sm" aria-label="Back to Apps" onClick={() => navigate('')}><ArrowLeft size={15}/></Button>
      <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">{app.name}</h1><p className="truncate text-xs text-muted-foreground">{app.account}</p></div>
      {accounts.length > 1 && <select aria-label="Connected account" value={app.id} onChange={event => navigate(`~connected/${event.target.value}`)} className="max-w-48 rounded-md border bg-background p-2 text-xs">{accounts.map(account => <option key={account.id} value={account.id}>{account.account}</option>)}</select>}
      <Button size="sm" variant="outline" onClick={() => navigate(app.providerId ? `?provider=${encodeURIComponent(app.providerId)}` : `?mcp=${encodeURIComponent(app.id)}`)}><Settings2 size={14}/>Connection</Button>
      <Button size="sm" onClick={() => setChat(true)}><MessageCircle size={14}/>Use in chat</Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"><div className="mx-auto max-w-5xl space-y-6">
      {!app.available && <p role="alert" className="text-sm text-muted-foreground">Reconnect or enable this account to open its app.</p>}
      {selected && <ConnectedView key={selected} captureId={selected} chatId={recent?.chatId}/>}
      <div><h2 className="text-sm font-medium">Start a workflow</h2><p className="mt-1 text-xs text-muted-foreground">Choose a workflow below, or ask Ri in chat. Interactive results open here and in the conversation.</p></div>
      <div className="grid gap-4 md:grid-cols-2">{app.tools.map(tool => <Workflow key={tool.name} app={app} tool={tool} onOpen={setCaptureId}/>)}</div>
    </div></div>
    <LibraryChat item={chat ? {key: `mcp:${app.id}`, name: app.name, kind: 'apps', description: '', keywords: '', target: app.providerId ? {kind: 'provider', id: app.providerId} : {kind: 'mcp', id: app.id}, chat: true, view: true, added: true, attention: false, status: '', sourceRef: app.sourceRef ?? undefined} : null} onClose={() => setChat(false)}/>
  </div>;
}
function Workflow({app, tool, onOpen}: {app: App; tool: Tool; onOpen: (id: string) => void}) {
  const schema = (tool.inputSchema ?? {}) as {properties?: Record<string, {type?: string; title?: string; description?: string; default?: unknown; enum?: unknown[]}>; required?: string[]};
  const [input, setInput] = useState<Record<string, unknown>>(() => Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([key, value]) => value.default !== undefined ? [[key, value.default]] : value.type === 'boolean' && schema.required?.includes(key) ? [[key, false]] : [])));
  const [advanced, setAdvanced] = useState('{}');
  const complex = Object.values(schema.properties ?? {}).some(field => !['string','number','integer','boolean'].includes(field.type ?? ''));
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<{viewId: string; ids: string[]; preview: unknown; invocationId: string; args: Record<string, unknown>} | null>(null);
  const [attempt, setAttempt] = useState<{viewId: string; invocationId: string; args: Record<string, unknown>} | null>(null);
  const alive = useRef(true);
  const activeAttempt = useRef<{viewId: string; invocationId: string} | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (activeAttempt.current) void trpcClient.connectedApps.cancel.mutate(activeAttempt.current).catch(() => {});
    };
  }, []);
  const decline = async () => {
    if (!approval || busy) return;
    setBusy(true); setError(null);
    try {
      await trpcClient.connectedApps.approval.mutate({viewId: approval.viewId, ids: approval.ids, approve: false});
      await trpcClient.connectedApps.cancel.mutate({viewId: approval.viewId, invocationId: approval.invocationId});
      if (!alive.current) return;
      activeAttempt.current = null;
      setApproval(null); setAttempt(null);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'The decision could not be saved'); }
    finally { if (alive.current) setBusy(false); }
  };
  const run = async (approve = false) => {
    setBusy(true); setError(null);
    try {
      if (approval && approve) await trpcClient.connectedApps.approval.mutate({viewId: approval.viewId, ids: approval.ids, approve: true});
      if (!alive.current) return;
      const args = approval?.args ?? (complex ? JSON.parse(advanced) : input);
      const request = approval ?? (attempt && JSON.stringify(attempt.args) === JSON.stringify(args) ? attempt : {...await trpcClient.connectedApps.prepare.mutate({serverId: app.id, name: tool.name, args}), args});
      if (!alive.current) {await trpcClient.connectedApps.cancel.mutate({viewId: request.viewId, invocationId: request.invocationId}); return;}
      activeAttempt.current = {viewId: request.viewId, invocationId: request.invocationId};
      setAttempt(request);
      const result = await trpcClient.connectedApps.launch.mutate({viewId: request.viewId});
      if (!alive.current) return;
      if (result.kind === 'approval') setApproval({...result, preview: result.preview, invocationId: request.invocationId, args: request.args});
      else { activeAttempt.current = null; setApproval(null); setAttempt(null); onOpen(result.captureId); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'The app could not open'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <form onSubmit={event => {event.preventDefault(); void run();}} className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="text-sm font-medium">{tool.title}</h3>{tool.description && <p className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{tool.description}</p>}
    {complex ? <label className="block text-xs">Workflow inputs<textarea aria-label={`${tool.title} inputs`} value={advanced} onChange={e => setAdvanced(e.target.value)} className="mt-1 block min-h-24 w-full rounded-md border bg-background p-2 font-mono"/></label>
      : Object.entries(schema.properties ?? {}).map(([key, field]) => <label key={key} className="block text-xs">{field.title ?? key}{schema.required?.includes(key) ? ' *' : ''}
        {field.enum ? <select value={String(input[key] ?? '')} required={schema.required?.includes(key)} onChange={e => setInput({...input, [key]: field.enum!.find(value => String(value) === e.target.value)})} className="mt-1 block w-full rounded-md border bg-background p-2"><option value="">Choose…</option>{field.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>
          : field.type === 'boolean' ? <input type="checkbox" checked={input[key] === true} onChange={e => setInput({...input, [key]: e.target.checked})} className="ml-2"/>
          : <input type={['number','integer'].includes(field.type ?? '') ? 'number' : 'text'} step={field.type === 'integer' ? 1 : 'any'} required={schema.required?.includes(key)} value={String(input[key] ?? '')} onChange={e => {const next = {...input}; if (e.target.value === '' && !schema.required?.includes(key)) delete next[key]; else next[key] = field.type === 'number' || field.type === 'integer' ? e.target.value === '' ? '' : Number(e.target.value) : e.target.value; setInput(next);}} className="mt-1 block w-full rounded-md border bg-background p-2"/>}
      </label>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {approval ? <div className="space-y-2 rounded-md bg-amber-500/10 p-3 text-xs"><p>Allow this workflow to run?</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(approval.preview, null, 2)}</pre><Button type="button" size="xs" disabled={busy} onClick={() => void run(true)}>Allow once</Button><Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void decline()}>Decline</Button></div>
      : <Button type="submit" size="sm" disabled={busy || !app.available}>{busy ? 'Opening…' : tool.global ? 'Open app' : 'Run workflow'}</Button>}
  </form>;
}
