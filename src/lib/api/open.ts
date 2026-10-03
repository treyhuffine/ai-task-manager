import { folderSourceFromBase, type FolderApiBase } from '@/lib/folders/source';
import { trpcClient } from '@/lib/trpc/client';
import type { OpenInClientOptions, OpenTarget } from './fs';
export const openApi = {
  apps(base: FolderApiBase) {
    const source = folderSourceFromBase(base);
    return source.kind === 'session' ? trpcClient.sessions.openGet.query({ params: { id: source.sessionId } }) : trpcClient.workspaces.openGet.query({ params: { id: source.workspaceId } });
  },
  open(base: FolderApiBase, path: string | null, target: OpenTarget, opts: Omit<OpenInClientOptions, 'projectDir'> = {}) {
    const source = folderSourceFromBase(base), body = { path, target, ...opts };
    return source.kind === 'session' ? trpcClient.sessions.openPost.mutate({ params: { id: source.sessionId }, body }) : trpcClient.workspaces.openPost.mutate({ params: { id: source.workspaceId }, body });
  },
};
