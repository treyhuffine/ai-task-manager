import { getChatSession } from '@/lib/db/queries';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLocalAppsDir } from '@/lib/config/paths';
import { encodeSource } from '@/lib/chat-sources/reference';
import type { SourceAdapter, SourceDescriptor } from '@/lib/chat-sources/types';
import { SourceError } from '@/lib/chat-sources/service';
import { localApps, type LocalAppsService } from './service';

/** Optional adapter. Metadata reads never validate/build a package or start a process. */
export function createLocalAppSourceAdapter(getApps: () => LocalAppsService = localApps): SourceAdapter { return {
  kind: 'app',
  async list(context) {
    const apps = getApps();
    const state = apps.store.read();
    return Promise.all(state.instances.map(async instance => {
      let label = instance.slug, view = false, chat = false;
      try {
        const file = path.join(getLocalAppsDir(), instance.id, 'package', 'plugin.json');
        const handle = await fs.open(file, 'r');
        try {
          if ((await handle.stat()).size > 65536) throw new Error('Manifest too large');
          const manifest = JSON.parse(await handle.readFile('utf8'));
          const extension = manifest.extensions?.['com.ri'];
          if (typeof extension?.displayName === 'string') label = extension.displayName.slice(0, 160);
          view = !!extension?.ui;
          chat = extension?.runtime?.kind === 'node';
        } finally { await handle.close(); }
      } catch { /* unavailable packages retain their installed identity */ }
      let status: SourceDescriptor['status'] = 'ready';
      if (!context.harnessReady || !instance.enabled || instance.archived || instance.activation?.phase !== 'active') status = 'unavailable';
      else { try { apps.grant(instance.id, { kind: 'chat', id: context.chatId }); } catch { status = 'needs_access'; } }
      return { sourceRef: encodeSource({ v: 1, kind: 'app', instanceId: instance.id }), label, service: label, groupId: `local:${instance.id}`, keywords: [label, instance.slug, instance.packageId], status, chat, view: view ? 'available' : 'none', openPath: `/apps/${instance.slug}`, managePath: `/apps/${instance.slug}?riAccessChat=${encodeURIComponent(context.chatId)}` };
    }));
  },
  async actions(ref, ctx) {
    if (ref.kind !== 'app') throw new SourceError('forbidden', 'Invalid app reference');
    const apps = getApps(); apps.instance(ref.instanceId);
    const grant = apps.grant(ref.instanceId, { kind: 'chat', id: ctx.chatId });
    const description = await apps.describe(ref.instanceId);
    return description.contract.actions.filter(a => grant.actions.includes(a.name) && a.audience.includes('agent') && a.visibility !== 'app')
      .map(a => ({ id: a.name, description: a.description, inputSchema: a.inputSchema, outputSchema: a.outputSchema, mutating: a.effect !== 'read' }));
  },
  async call(ref, ctx, action, input, invocationId, signal) {
    if (ref.kind !== 'app') throw new SourceError('forbidden', 'Invalid app reference');
    return getApps().call(ref.instanceId, action, input, { kind: 'chat', id: ctx.chatId }, invocationId, signal);
  },
  async open(ref, ctx) {
    if (ref.kind !== 'app') throw new SourceError('forbidden', 'Invalid app reference');
    await getApps().setPanel(ctx.chatId, ref.instanceId);
  },
}; }
export const localAppSourceAdapter = createLocalAppSourceAdapter();

export function sourceChatAllowed(chatId: string) {
  const chat = getChatSession(chatId);
  return chat?.surfaceKind !== 'app-builder' && chat?.surfaceKind !== 'app-try';
}
