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

export const terminalsApi = {
  list(sessionId: string): Promise<TerminalDescriptor[]> {
    return api.get<TerminalDescriptor[]>(`/sessions/${sessionId}/terminals`);
  },

  create(
    sessionId: string,
    dims: { cols: number; rows: number },
  ): Promise<TerminalDescriptor> {
    return api.post<TerminalDescriptor>(`/sessions/${sessionId}/terminals`, dims);
  },

  kill(sessionId: string, terminalId: string): Promise<{ ok: true }> {
    return api.delete<{ ok: true }>(`/sessions/${sessionId}/terminals/${terminalId}`);
  },

  input(sessionId: string, terminalId: string, data: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(
      `/sessions/${sessionId}/terminals/${terminalId}/input`,
      { data },
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
    );
  },

  /** Path used by `EventSource` for the SSE output stream. */
  streamUrl(sessionId: string, terminalId: string): string {
    return `/api/sessions/${sessionId}/terminals/${terminalId}/stream`;
  },
};
