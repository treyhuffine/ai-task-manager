import { trpcClient } from '@/lib/trpc/client';

export type ConnectedLaunchRequest = Parameters<typeof trpcClient.connectedApps.prepare.mutate>[0];
export type LaunchApproval = { ids: string[]; preview?: unknown };

/** The person declined the operation a launch needed. Nothing ran. */
export class LaunchDeclined extends Error {
  constructor() { super('Declined. The app did not open.'); this.name = 'LaunchDeclined'; }
}

type Client = Pick<typeof trpcClient.connectedApps, 'prepare' | 'launch' | 'approval' | 'cancel'>;

/**
 * A person opening an app (a thread tab, a file viewer, a settings button, a
 * form preview, a global screen): prepare it, then run its tool through the
 * ordinary approval gate. `ask` shows the native approval and resolves with
 * the person's answer. An instance that is already open comes back as is,
 * without calling the tool. Aborting cancels an unanswered launch.
 */
export async function launchConnectedApp(request: ConnectedLaunchRequest, ask: (approval: LaunchApproval) => Promise<boolean>,
  options: {signal?: AbortSignal; client?: Client} = {}): Promise<{captureId: string; deepLink?: string | null; reused: boolean}> {
  const client = options.client ?? trpcClient.connectedApps;
  const prepared = await client.prepare.mutate(request);
  if (prepared.kind === 'open') return {captureId: prepared.captureId, deepLink: prepared.deepLink ?? null, reused: true};
  const handle = {viewId: prepared.viewId, invocationId: prepared.invocationId};
  const cancel = () => void client.cancel.mutate(handle).catch(() => {});
  options.signal?.addEventListener('abort', cancel, {once: true});
  try {
    for (;;) {
      if (options.signal?.aborted) throw new Error('The app was closed before it opened.');
      const result = await client.launch.mutate({viewId: handle.viewId});
      if (result.kind === 'opened') return {captureId: result.captureId, reused: false};
      const approve = await ask({ids: result.ids, preview: result.preview});
      await client.approval.mutate({viewId: result.viewId, ids: result.ids, approve});
      if (!approve) { cancel(); throw new LaunchDeclined(); }
    }
  } finally {
    options.signal?.removeEventListener('abort', cancel);
  }
}
