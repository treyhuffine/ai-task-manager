'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppWindow, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tip } from '@/components/ui/tip';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { fileExtension, launchConnectedFile, showConnectedCapture, type FileLaunchApproval } from '@/lib/client/mcp-app-file';
import { useConnectedCompanion } from '@/lib/client/mcp-app-panel';
import { trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { connectedAppsQuery } from './catalog';

type App = RouterOutputs['connectedApps']['catalog'][number];
/** A file the person can open with an app: a chat attachment, or a file in an agent's folder. */
export type OpenWithFile =
  | { kind: 'attachment'; fileName: string; name: string }
  | { kind: 'agent-file'; workspaceId: string; path: string; name: string };
export interface FileApp { app: App; tool: string; title: string; label: string }

/**
 * The connected apps whose file entrypoint (OpenAI's MCP extensions spec)
 * lists this file's extension, on accounts that can open it now. A product
 * with several accounts names the account too.
 */
export function fileAppsFor(apps: readonly App[] | undefined, name: string): FileApp[] {
  const extension = fileExtension(name);
  if (!extension || !apps) return [];
  const matches = apps.filter(app => app.available).flatMap(app => app.files.filter(entry => entry.extensions.includes(extension)).map(entry => ({app, entry})));
  return matches.map(({app, entry}) => {
    const several = matches.filter(other => other.app.toolkitName === app.toolkitName).length > 1;
    return {app, tool: entry.name, title: entry.title, label: several ? `${app.toolkitName} · ${app.account}` : app.toolkitName};
  });
}

/**
 * "Open with <app>" for a file. Beside a chat, the app opens in the pane at
 * its side, as a tab of that chat. Elsewhere it opens the app's page full
 * screen. Opening calls the app's file entrypoint through the ordinary
 * approval gate, and the app reaches the file only through Ri: it never sees
 * a path on this computer.
 */
export function OpenWithApp({file, className}: {file: OpenWithFile; className?: string}) {
  const companion = useConnectedCompanion();
  const dashboard = useOptionalDashboard();
  const catalog = useQuery({...connectedAppsQuery(), enabled: !!fileExtension(file.name)});
  const apps = fileAppsFor(catalog.data, file.name);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<(FileLaunchApproval & {app: FileApp; answer: (allow: boolean) => void}) | null>(null);
  if (!apps.length) return null;
  const chatId = file.kind === 'attachment' ? companion?.chatId ?? null : null;

  const open = async (choice: FileApp) => {
    setBusy(true);
    try {
      const {handle} = await trpcClient.connectedApps.files.handle.mutate(file.kind === 'attachment'
        ? {kind: 'attachment', fileName: file.fileName, name: file.name}
        : {kind: 'agent-file', workspaceId: file.workspaceId, path: file.path});
      const captureId = await launchConnectedFile({serverId: choice.app.id, tool: choice.tool, handle, chatId,
        ask: (request, signal) => new Promise<boolean>(resolve => {
          const answer = (allow: boolean) => { setApproval(null); resolve(allow); };
          signal.addEventListener('abort', () => answer(false), {once: true});
          setApproval({...request, app: choice, answer});
        })});
      showConnectedCapture({captureId, serverId: choice.app.id, chatId}, {companion, setActiveView: dashboard?.setActiveView});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${choice.label} could not open ${file.name}`);
    } finally { setBusy(false); }
  };

  const icon = busy ? <Loader2 size={12} className="animate-spin"/> : <AppWindow size={12}/>;
  return <span className={className}>
    {apps.length === 1
      ? <Tip label={`Opens ${file.name} in ${apps[0].title}`} onlyWhenTextHidden>
          <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void open(apps[0])} className="h-6 gap-1 px-1.5 text-[11px]">
            {icon}<span className="truncate">Open with {apps[0].label}</span>
          </Button>
        </Tip>
      : <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="xs" variant="ghost" disabled={busy} className="h-6 gap-1 px-1.5 text-[11px]">{icon}Open with<ChevronDown size={11}/></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {apps.map(choice => <DropdownMenuItem key={`${choice.app.id}:${choice.tool}`} onSelect={() => void open(choice)}>{choice.label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>}
    {approval && <span role="group" aria-label={`Allow ${approval.app.label} to open ${file.name}`} className="mt-1 block space-y-2 rounded-lg bg-amber-500/10 p-2.5 text-xs">
      <span className="block">Allow {approval.app.label} to open {file.name}?</span>
      {approval.preview != null && <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(approval.preview, null, 2)}</pre>}
      <span className="flex gap-2">
        <Button type="button" size="xs" onClick={() => approval.answer(true)}>Allow once</Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => approval.answer(false)}>Decline</Button>
      </span>
    </span>}
  </span>;
}
