import { terminalSourceFromBase, type TerminalApiBase } from '@/lib/folders/source';
import { terminalTRPCClient } from '@/lib/trpc/client';
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
 * Every call takes the source's route base (`terminalApiBase`):
 * `/sessions/:id` for an execution's worktree, `/workspaces/:id` for an
 * agent's own folder, `/home` for Home's shells on the box. All three
 * expose the same terminal procedures.
 */
export const terminalsApi = {
  list(base: TerminalApiBase, signal?: AbortSignal) {
    const source = terminalSourceFromBase(base);
    switch (source.kind) {
      case 'session': return terminalTRPCClient.sessions.terminalsGet.query({ params: { id: source.sessionId } }, { signal });
      case 'workspace': return terminalTRPCClient.workspaces.terminalsGet.query({ params: { id: source.workspaceId } }, { signal });
      case 'home': return terminalTRPCClient.home.terminalsGet.query({}, { signal });
    }
  },
  create(base: TerminalApiBase, dims: { cols: number; rows: number }) {
    const source = terminalSourceFromBase(base), options = rpcOptions({ timeoutMs: CREATE_TIMEOUT_MS });
    switch (source.kind) {
      case 'session': return terminalTRPCClient.sessions.terminalsPost.mutate({ params: { id: source.sessionId }, body: dims }, options);
      case 'workspace': return terminalTRPCClient.workspaces.terminalsPost.mutate({ params: { id: source.workspaceId }, body: dims }, options);
      case 'home': return terminalTRPCClient.home.terminalsPost.mutate({ body: dims }, options);
    }
  },
  kill(base: TerminalApiBase, terminalId: string) {
    const source = terminalSourceFromBase(base);
    switch (source.kind) {
      case 'session': return terminalTRPCClient.sessions.terminalsTerminalIdDelete.mutate({ params: { id: source.sessionId, terminalId } });
      case 'workspace': return terminalTRPCClient.workspaces.terminalsTerminalIdDelete.mutate({ params: { id: source.workspaceId, terminalId } });
      case 'home': return terminalTRPCClient.home.terminalsTerminalIdDelete.mutate({ params: { terminalId } });
    }
  },
  input(base: TerminalApiBase, terminalId: string, data: string) {
    const source = terminalSourceFromBase(base), options = rpcOptions({ timeoutMs: WRITE_TIMEOUT_MS });
    switch (source.kind) {
      case 'session': return terminalTRPCClient.sessions.terminalsInputTerminalIdPost.mutate({ params: { id: source.sessionId, terminalId }, body: { data } }, options);
      case 'workspace': return terminalTRPCClient.workspaces.terminalsInputTerminalIdPost.mutate({ params: { id: source.workspaceId, terminalId }, body: { data } }, options);
      case 'home': return terminalTRPCClient.home.terminalsInputTerminalIdPost.mutate({ params: { terminalId }, body: { data } }, options);
    }
  },
  resize(base: TerminalApiBase, terminalId: string, dims: { cols: number; rows: number }) {
    const source = terminalSourceFromBase(base), options = rpcOptions({ timeoutMs: WRITE_TIMEOUT_MS });
    switch (source.kind) {
      case 'session': return terminalTRPCClient.sessions.terminalsResizeTerminalIdPost.mutate({ params: { id: source.sessionId, terminalId }, body: dims }, options);
      case 'workspace': return terminalTRPCClient.workspaces.terminalsResizeTerminalIdPost.mutate({ params: { id: source.workspaceId, terminalId }, body: dims }, options);
      case 'home': return terminalTRPCClient.home.terminalsResizeTerminalIdPost.mutate({ params: { terminalId }, body: dims }, options);
    }
  },
};
