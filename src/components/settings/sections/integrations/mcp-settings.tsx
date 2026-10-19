'use client';

/**
 * An MCP server's own settings on its connection page (OpenAI's structured
 * settings, docs/connected-mcp-apps.md "Settings"). The server publishes a
 * schema, values and a layout, and Ri draws them with its own controls. A
 * switch or a choice saves as it changes, text and numbers on blur or Enter.
 * Buttons run a server tool, or open its interface in a dialog.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AppWindow, Loader2, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { settingsFields, validateSetting, type SettingField, type SettingValue, type SettingsItem, type SettingsView } from '@/lib/mcp-apps/settings-model';
import { GroupHeading } from './parts';

// The app host loads only when a settings button opens an interface.
const ConnectedView = dynamic(() => import('@/components/mcp-apps/view').then(module => module.ConnectedView), { ssr: false });

const errorText = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;
const without = <T,>(entries: Record<string, T>, key: string) => Object.fromEntries(Object.entries(entries).filter(([name]) => name !== key));

/**
 * Settings for one MCP server account. `enabled` is whether the server
 * publishes settings and its account is connected and on. Nothing renders,
 * and nothing is asked of the server, otherwise.
 */
export function McpServerSettings({ serverId, name, enabled }: { serverId: string; name: string; enabled: boolean }) {
  return enabled ? <LoadedSettings serverId={serverId} name={name} /> : null;
}

function LoadedSettings({ serverId, name }: { serverId: string; name: string }) {
  const queryClient = useQueryClient();
  const options = trpc.mcpSettings.read.queryOptions({ serverId }, { staleTime: 30_000, retry: false, refetchOnWindowFocus: false });
  const settings = useQuery(options);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useMutation({
    mutationFn: (set: Record<string, SettingValue>) => trpcClient.mcpSettings.update.mutate({ serverId, set }),
    // A typed value has no other copy until the server keeps it.
    meta: { carriesInput: true },
  });
  const data = settings.data?.available ? settings.data : null;

  const save = useCallback(async (key: string, value: SettingValue) => {
    if (!data) return;
    const field = settingsFields(data).get(key);
    const problem = field ? validateSetting(field, value) : 'This setting is no longer available.';
    if (problem) { setErrors(previous => ({ ...previous, [key]: problem })); return; }
    setErrors(current => without(current, key));
    const previous = data.values[key];
    if (previous === value) return;
    const patch = (values: Record<string, SettingValue>) => queryClient.setQueryData(options.queryKey, current => current?.available ? { ...current, values: { ...current.values, ...values } } : current);
    patch({ [key]: value });
    setSaving(current => ({ ...current, [key]: true }));
    try {
      const { values } = await update.mutateAsync({ [key]: value });
      patch(values);
    } catch (error) {
      if (previous !== undefined) patch({ [key]: previous });
      setErrors(current => ({ ...current, [key]: errorText(error, 'The server did not save this setting.') }));
    } finally {
      setSaving(current => without(current, key));
    }
  }, [data, options.queryKey, queryClient, update]);

  if (settings.data?.available === false) return null;
  return <section aria-label={`Settings for ${name}`} className="@container space-y-4 rounded-xl border border-border bg-card/20 p-4">
    <GroupHeading action={settings.isFetching && data ? <Loader2 size={12} className="animate-spin text-muted-foreground" aria-label="Refreshing settings" /> : undefined}>Settings</GroupHeading>
    {settings.isPending && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" />Loading settings from {name}…</p>}
    {settings.isError && <div role="alert" className="space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{errorText(settings.error, 'The settings could not load.')}</p>
      <Button size="xs" variant="outline" onClick={() => void settings.refetch()}><RefreshCw size={12} />Try again</Button>
    </div>}
    {data && <McpSettingsGroups serverId={serverId} view={data} saving={saving} errors={errors} onSave={save}
      onToolDone={() => void queryClient.invalidateQueries({ queryKey: options.queryKey })} />}
  </section>;
}

/** The groups themselves: fields with their current values, and tool buttons. Rendered alone in tests. */
export function McpSettingsGroups({ serverId, view, saving = {}, errors = {}, onSave, onToolDone }: {
  serverId: string; view: SettingsView; saving?: Record<string, boolean>; errors?: Record<string, string>;
  onSave: (key: string, value: SettingValue) => void; onToolDone?: () => void;
}) {
  return <div className="space-y-5">
    {view.groups.map(group => <div key={group.title} role="group" aria-label={group.title} className="space-y-2">
      <h4 className="text-xs font-medium">{group.title}</h4>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-background/40">
        {group.items.map(item => <SettingsRow key={item.kind === 'property' ? `property:${item.field.key}` : `tool:${item.tool}`} serverId={serverId} item={item}
          value={item.kind === 'property' ? view.values[item.field.key] : undefined} saving={item.kind === 'property' && !!saving[item.field.key]}
          error={item.kind === 'property' ? errors[item.field.key] : undefined} onSave={onSave} onToolDone={onToolDone} />)}
      </div>
    </div>)}
  </div>;
}

function SettingsRow({ serverId, item, value, saving, error, onSave, onToolDone }: {
  serverId: string; item: SettingsItem; value: SettingValue | undefined; saving: boolean; error?: string;
  onSave: (key: string, value: SettingValue) => void; onToolDone?: () => void;
}) {
  if (item.kind === 'tool') return <SettingsTool serverId={serverId} item={item} onDone={onToolDone} />;
  const { field } = item;
  const id = `mcp-setting-${serverId}-${field.key}`;
  return <div className="flex flex-col gap-2 px-3 py-2.5 @md:flex-row @md:items-start @md:justify-between @md:gap-4">
    <div className="min-w-0 space-y-0.5">
      <label htmlFor={id} className="block text-xs font-medium break-words">{field.title}</label>
      {field.description && <p className="text-[11px] leading-normal text-muted-foreground">{field.description}</p>}
    </div>
    <div className="flex min-w-0 flex-col gap-1 @md:w-64 @md:shrink-0 @md:items-end">
      <div className="flex w-full items-center gap-2 @md:justify-end">
        {saving && <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" aria-label="Saving" />}
        <SettingControl id={id} field={field} value={value} invalid={!!error} onSave={next => onSave(field.key, next)} />
      </div>
      {error && <p role="alert" className="text-[11px] leading-normal text-destructive @md:text-right">{error}</p>}
    </div>
  </div>;
}

function SettingControl({ id, field, value, invalid, onSave }: { id: string; field: SettingField; value: SettingValue | undefined; invalid: boolean; onSave: (value: SettingValue) => void }) {
  switch (field.type) {
    case 'unsupported':
      return <p id={id} className="text-[11px] leading-normal text-muted-foreground @md:text-right">{field.reason}</p>;
    case 'boolean':
      return <Switch id={id} checked={value === true} aria-invalid={invalid || undefined} onCheckedChange={onSave} />;
    case 'string':
      if (field.enum) return <Select value={typeof value === 'string' ? value : undefined} onValueChange={onSave}>
        <SelectTrigger id={id} aria-invalid={invalid || undefined} className="w-full min-w-0 rounded-lg text-xs @md:w-auto @md:min-w-36 [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger>
        <SelectContent position="popper" align="end">{field.enum.map(option => <SelectItem key={option} value={option} className="text-xs">{option}</SelectItem>)}</SelectContent>
      </Select>;
      return <DraftInput id={id} value={typeof value === 'string' ? value : ''} invalid={invalid} onCommit={draft => onSave(draft)} />;
    case 'number':
    case 'integer':
      return <DraftInput id={id} value={typeof value === 'number' ? String(value) : ''} invalid={invalid} inputMode={field.type === 'integer' ? 'numeric' : 'decimal'}
        // An empty or non-numeric entry becomes NaN, which validation names, rather than a silent zero.
        onCommit={draft => onSave(draft.trim() === '' ? Number.NaN : Number(draft.trim()))} />;
  }
}

/** Text the person is typing, saved on blur or Enter and put back on Escape. */
function DraftInput({ id, value, invalid, inputMode, onCommit }: { id: string; value: string; invalid: boolean; inputMode?: 'numeric' | 'decimal'; onCommit: (draft: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value);
  // Follow the server's value unless the person is mid-edit.
  if (value !== shown && !editing) { setShown(value); setDraft(value); }
  const commit = () => { setEditing(false); if (draft !== value) onCommit(draft); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { setEditing(false); setDraft(value); }
  };
  return <Input id={id} value={draft} inputMode={inputMode} aria-invalid={invalid || undefined} className="h-8 w-full text-xs @md:w-56"
    onFocus={() => setEditing(true)} onChange={event => { setEditing(true); setDraft(event.target.value); }} onBlur={commit} onKeyDown={onKeyDown} />;
}

/**
 * A settings button. A plain tool runs with `{}` and its reply shows beside
 * the button. A tool with an interface opens it in a dialog.
 */
function SettingsTool({ serverId, item, onDone }: { serverId: string; item: Extract<SettingsItem, { kind: 'tool' }>; onDone?: () => void }) {
  const [reply, setReply] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const run = useMutation({ mutationFn: () => trpcClient.mcpSettings.runTool.mutate({ serverId, tool: item.tool }) });
  const click = async () => {
    setReply(null);
    try {
      const result = await run.mutateAsync();
      if (result.kind === 'app') setOpen(true);
      else { setReply({ ok: true, text: result.text }); onDone?.(); }
    } catch (error) { setReply({ ok: false, text: errorText(error, `${item.title} did not run.`) }); }
  };
  return <div className="flex flex-col gap-2 px-3 py-2.5 @md:flex-row @md:items-start @md:justify-between @md:gap-4">
    <div className="min-w-0 space-y-0.5">
      {item.description && <p className="text-[11px] leading-normal text-muted-foreground">{item.description}</p>}
      {!item.available && <p className="text-[11px] text-muted-foreground">This server no longer offers this tool.</p>}
      {reply && <p role={reply.ok ? 'status' : 'alert'} className={cn('whitespace-pre-wrap text-[11px] leading-normal [overflow-wrap:anywhere]', reply.ok ? 'text-foreground' : 'text-destructive')}>{reply.text}</p>}
    </div>
    <Button size="xs" variant="outline" className="shrink-0 self-start text-xs @md:ml-auto" disabled={!item.available || run.isPending} onClick={() => void click()}>
      {run.isPending ? <Loader2 size={12} className="animate-spin" /> : item.app ? <AppWindow size={12} /> : <Play size={12} />}{item.title}
    </Button>
    {open && <SettingsAppDialog serverId={serverId} tool={item.tool} title={item.title} onClose={() => { setOpen(false); onDone?.(); }} />}
  </div>;
}

type LaunchState =
  | { kind: 'opening' }
  | { kind: 'approval'; viewId: string; invocationId: string; ids: string[]; preview?: unknown }
  | { kind: 'opened'; captureId: string }
  | { kind: 'error'; message: string };

/**
 * Opening a settings button's interface: the tool runs with `{}` through the
 * ordinary approval gate as a `settings` view. Closing the dialog first
 * cancels an unanswered launch.
 */
function useSettingsLaunch(serverId: string, tool: string) {
  const [state, setState] = useState<LaunchState>({ kind: 'opening' });
  const [busy, setBusy] = useState(false);
  // Each attempt has a number. Closing, or a newer attempt, makes an older one stale, so a late
  // reply from it changes nothing (React may also run the opening effect twice in development).
  const generation = useRef(0);
  const active = useRef<{ viewId: string; invocationId: string } | null>(null);
  const launch = useCallback(async (attempt: number, request: { viewId: string; invocationId: string }) => {
    active.current = request;
    const result = await trpcClient.connectedApps.launch.mutate({ viewId: request.viewId });
    if (attempt !== generation.current) return;
    if (result.kind === 'approval') { setState({ kind: 'approval', viewId: result.viewId, invocationId: request.invocationId, ids: result.ids, preview: result.preview }); return; }
    active.current = null;
    setState({ kind: 'opened', captureId: result.captureId });
  }, []);
  const start = useCallback(async () => {
    const attempt = ++generation.current;
    setBusy(true); setState({ kind: 'opening' });
    try {
      const prepared = await trpcClient.connectedApps.prepare.mutate({ serverId, name: tool, kind: 'settings' });
      if (prepared.kind === 'open') { if (attempt === generation.current) setState({ kind: 'opened', captureId: prepared.captureId }); return; }
      const request = { viewId: prepared.viewId, invocationId: prepared.invocationId };
      if (attempt !== generation.current) { await trpcClient.connectedApps.cancel.mutate(request); return; }
      await launch(attempt, request);
    } catch (error) { if (attempt === generation.current) { active.current = null; setState({ kind: 'error', message: errorText(error, 'This interface could not open.') }); } }
    finally { if (attempt === generation.current) setBusy(false); }
  }, [serverId, tool, launch]);
  useEffect(() => {
    const attempts = generation, pending = active;
    void start();
    return () => {
      attempts.current++;
      if (pending.current) void trpcClient.connectedApps.cancel.mutate(pending.current).catch(() => {});
      pending.current = null;
    };
  }, [start]);
  const decide = useCallback(async (approve: boolean) => {
    if (state.kind !== 'approval' || busy) return;
    const attempt = generation.current;
    setBusy(true);
    try {
      await trpcClient.connectedApps.approval.mutate({ viewId: state.viewId, ids: state.ids, approve });
      if (!approve) {
        await trpcClient.connectedApps.cancel.mutate({ viewId: state.viewId, invocationId: state.invocationId });
        active.current = null;
        if (attempt === generation.current) setState({ kind: 'error', message: 'You declined, so it did not open.' });
        return;
      }
      if (attempt === generation.current) setState({ kind: 'opening' });
      await launch(attempt, { viewId: state.viewId, invocationId: state.invocationId });
    } catch (error) { if (attempt === generation.current) setState({ kind: 'error', message: errorText(error, 'The decision could not be saved.') }); }
    finally { if (attempt === generation.current) setBusy(false); }
  }, [state, busy, launch]);
  return { state, busy, start, decide };
}

function SettingsAppDialog({ serverId, tool, title, onClose }: { serverId: string; tool: string; title: string; onClose: () => void }) {
  const { state, busy, start, decide } = useSettingsLaunch(serverId, tool);
  const opened = state.kind === 'opened';
  let body: ReactNode;
  if (state.kind === 'opened') body = <ConnectedView captureId={state.captureId} expanded />;
  else if (state.kind === 'opening') body = <p role="status" className="flex items-center gap-2 p-6 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />Opening {title}…</p>;
  else if (state.kind === 'approval') body = <div role="group" aria-label={`Allow ${title} to open`} className="m-4 space-y-3 rounded-xl bg-amber-500/10 p-4 text-sm">
    <p>Allow {title} to open?</p>
    {state.preview != null && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state.preview, null, 2)}</pre>}
    <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void decide(true)}>Allow once</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(false)}>Decline</Button></div>
  </div>;
  else body = <div role="alert" className="space-y-3 p-6 text-sm">
    <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{state.message}</p>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void start()}>Try again</Button>
  </div>;
  return <Dialog open onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className="flex h-[min(85vh,760px)] max-w-[min(960px,calc(100%-2rem))] flex-col gap-3 p-4 sm:max-w-[min(960px,calc(100%-2rem))]">
      {/* Once the interface is open, its own header names it. */}
      <DialogHeader className={opened ? 'sr-only' : undefined}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">An interface from this MCP server, opened from its settings.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">{body}</div>
    </DialogContent>
  </Dialog>;
}
