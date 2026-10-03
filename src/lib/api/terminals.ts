import { folderSourceFromBase, type FolderApiBase } from '@/lib/folders/source';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions } from '@/lib/trpc/request-options';
import type { RouterOutputs } from '@/lib/trpc/router';

export type TerminalDescriptor = RouterOutputs['sessions']['terminalsPost'];

/**
 * Every terminal call is bounded.
 *
 * A request that never settles is worse here than one that fails. An
 * unbounded `create` leaves the mutation `isPending` forever, which
 * disables the `+` button and suppresses auto-create — the terminal panel
 * silently stops working with no error to retry from. An unbounded `input`
 * is worse still: stdin is serialised to keep byte order, so one hung write
 * blocks every keystroke behind it.
 *
 * Sized off measured worst cases rather than round numbers. A single POST
 * through a degraded tunnel was seen at 15s, so the write timeouts sit well
 * clear of that to avoid failing a request that would have landed.
 */
const CREATE_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 30_000;

/**
 * Every call takes the folder's route base (`folderApiBase`):
 * `/sessions/:id` for an execution's worktree, `/workspaces/:id` for an
 * agent's own folder. Both expose the same terminal routes.
 */
export const terminalsApi = {
  list(base: FolderApiBase, signal?: AbortSignal) {
    const source = folderSourceFromBase(base);
    return source.kind === 'session' ? trpcClient.sessions.terminalsGet.query({ params: { id: source.sessionId } }, { signal }) : trpcClient.workspaces.terminalsGet.query({ params: { id: source.workspaceId } }, { signal });
  },
  create(base: FolderApiBase, dims: { cols: number; rows: number }) {
    const source = folderSourceFromBase(base), options = rpcOptions({ timeoutMs: CREATE_TIMEOUT_MS });
    return source.kind === 'session' ? trpcClient.sessions.terminalsPost.mutate({ params: { id: source.sessionId }, body: dims }, options) : trpcClient.workspaces.terminalsPost.mutate({ params: { id: source.workspaceId }, body: dims }, options);
  },
  kill(base: FolderApiBase, terminalId: string) {
    const source = folderSourceFromBase(base);
    return source.kind === 'session' ? trpcClient.sessions.terminalsTerminalIdDelete.mutate({ params: { id: source.sessionId, terminalId } }) : trpcClient.workspaces.terminalsTerminalIdDelete.mutate({ params: { id: source.workspaceId, terminalId } });
  },
  input(base: FolderApiBase, terminalId: string, data: string) {
    const source = folderSourceFromBase(base), options = rpcOptions({ timeoutMs: WRITE_TIMEOUT_MS });
    return source.kind === 'session' ? trpcClient.sessions.terminalsInputTerminalIdPost.mutate({ params: { id: source.sessionId, terminalId }, body: { data } }, options) : trpcClient.workspaces.terminalsInputTerminalIdPost.mutate({ params: { id: source.workspaceId, terminalId }, body: { data } }, options);
  },
  resize(base: FolderApiBase, terminalId: string, dims: { cols: number; rows: number }) {
    const source = folderSourceFromBase(base), options = rpcOptions({ timeoutMs: WRITE_TIMEOUT_MS });
    return source.kind === 'session' ? trpcClient.sessions.terminalsResizeTerminalIdPost.mutate({ params: { id: source.sessionId, terminalId }, body: dims }, options) : trpcClient.workspaces.terminalsResizeTerminalIdPost.mutate({ params: { id: source.workspaceId, terminalId }, body: dims }, options);
  },
  streamUrl(base: FolderApiBase, terminalId: string) { return `/api${base}/terminals/${terminalId}/stream`; },
};
