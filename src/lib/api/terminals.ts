import { api } from './client';

export interface TerminalDescriptor {
  id: string;
  sessionId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number | null;
  createdAt: string;
}

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

export const terminalsApi = {
  list(sessionId: string): Promise<TerminalDescriptor[]> {
    return api.get<TerminalDescriptor[]>(`/sessions/${sessionId}/terminals`);
  },

  create(
    sessionId: string,
    dims: { cols: number; rows: number },
  ): Promise<TerminalDescriptor> {
    return api.post<TerminalDescriptor>(`/sessions/${sessionId}/terminals`, dims, {
      timeoutMs: CREATE_TIMEOUT_MS,
    });
  },

  kill(sessionId: string, terminalId: string): Promise<{ ok: true }> {
    return api.delete<{ ok: true }>(`/sessions/${sessionId}/terminals/${terminalId}`);
  },

  input(sessionId: string, terminalId: string, data: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(
      `/sessions/${sessionId}/terminals/${terminalId}/input`,
      { data },
      { timeoutMs: WRITE_TIMEOUT_MS },
    );
  },

  resize(
    sessionId: string,
    terminalId: string,
    dims: { cols: number; rows: number },
  ): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(
      `/sessions/${sessionId}/terminals/${terminalId}/resize`,
      dims,
      { timeoutMs: WRITE_TIMEOUT_MS },
    );
  },

  /** Path used by `EventSource` for the SSE output stream. */
  streamUrl(sessionId: string, terminalId: string): string {
    return `/api/sessions/${sessionId}/terminals/${terminalId}/stream`;
  },
};
