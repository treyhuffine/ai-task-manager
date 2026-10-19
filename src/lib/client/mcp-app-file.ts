import { trpcClient } from '@/lib/trpc/client';
import type { ActiveView } from '@/types/dashboard';

/** An approval the launch is waiting on, as the native card shows it. */
export interface FileLaunchApproval { ids: string[]; preview?: unknown }

/**
 * Open a file in a connected app's file viewer (OpenAI's file entrypoint):
 * prepare the view for the host handle, then call the entrypoint through the
 * ordinary approval gate, asking the person when it needs approval. Leaving
 * (`signal`) cancels an unanswered launch. Resolves with the opened result's
 * capture, which shows like any other.
 */
export async function launchConnectedFile(options: {
  serverId: string; tool: string; handle: string; chatId?: string | null;
  ask: (approval: FileLaunchApproval, signal: AbortSignal) => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<string> {
  const signal = options.signal ?? new AbortController().signal;
  const prepared = await trpcClient.connectedApps.prepare.mutate({serverId: options.serverId, name: options.tool, kind: 'file',
    file: {handle: options.handle}, ...(options.chatId ? {chatId: options.chatId} : {})});
  if (prepared.kind === 'open') return prepared.captureId;
  const request = {viewId: prepared.viewId, invocationId: prepared.invocationId};
  const cancel = () => void trpcClient.connectedApps.cancel.mutate(request).catch(() => {});
  try {
    signal.throwIfAborted();
    let outcome = await trpcClient.connectedApps.launch.mutate({viewId: request.viewId});
    if (outcome.kind === 'approval') {
      const approved = await options.ask({ids: outcome.ids, preview: outcome.preview}, signal);
      await trpcClient.connectedApps.approval.mutate({viewId: request.viewId, ids: outcome.ids, approve: approved});
      if (!approved) { cancel(); throw new Error('You declined opening this file.'); }
      outcome = await trpcClient.connectedApps.launch.mutate({viewId: request.viewId});
      if (outcome.kind === 'approval') { cancel(); throw new Error('Approval expired. Open the file again.'); }
    }
    return outcome.captureId;
  } catch (error) {
    if (signal.aborted) cancel();
    throw error;
  }
}

/**
 * Where an opened file view shows: beside the chat it was opened from, or the
 * app's page full screen when there is no chat.
 */
export function showConnectedCapture(target: {captureId: string; serverId: string; chatId?: string | null},
  places: {companion?: {open: (id: string | null) => void} | null; setActiveView?: (view: ActiveView) => void}) {
  if (target.chatId && places.companion) { places.companion.open(target.captureId); return; }
  const query = {screen: target.captureId};
  if (places.setActiveView) { places.setActiveView({kind: 'apps', route: `~connected/${target.serverId}`, query}); return; }
  window.location.assign(`/apps/~connected/${encodeURIComponent(target.serverId)}?screen=${encodeURIComponent(target.captureId)}`);
}

/** A file name's extension in the form file entrypoints list it: the dot and what follows, lowercase. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}
