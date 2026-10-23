/** A private Home's connected team socket. Only its selected member credential goes upstream. */
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import { isTeamAuthority } from '@/lib/home/authority';
import { documentBindingMatches } from '@/lib/home/document-binding';
import { teamFor, isCurrentTeam, recordTeamFailure } from '@/lib/spaces/connect';
import { TeamRequestError, teamProblemMessage } from '@/lib/spaces/remote';
import { perfScope } from '@/lib/perf/recorder';
import { createWebSocketContext } from './ws-auth';

const INPUT_LIMIT = 2 * 1024 * 1024;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
type Team = NonNullable<Awaited<ReturnType<typeof teamFor>>>;
type Context = ReturnType<typeof createWebSocketContext>;

export function createSpaceWebSocketRelay() {
  const server = new WebSocketServer({ noServer: true, maxPayload: INPUT_LIMIT, perMessageDeflate: false });
  const checks = new Map<WebSocket, () => void>();
  let closing = false;
  const sweep = setInterval(() => {
    if (!checks.size) return;
    perfScope('timer:space-websocket-authority', () => {
      for (const [client, check] of checks) {
        try { check(); } catch { client.close(4403, 'The Home or team sign-in changed.'); }
      }
    });
  }, 1_000);
  sweep.unref();

  function attach(client: WebSocket, request: Request, teamId: string) {
    let context: Context | null = null;
    let team: Team | null = null;
    let upstream: WebSocket | null = null;
    let opening = false;
    let ended = false;
    let pending: string[] = [];
    let pendingBytes = 0;
    const deadline = setTimeout(() => client.close(4408, 'Team connection timed out.'), 10_000);
    deadline.unref();
    const end = (code: number, message: string) => {
      if (ended) return;
      ended = true;
      pending = []; pendingBytes = 0;
      clearTimeout(deadline); checks.delete(client);
      if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
      else upstream?.close();
      client.close(code, message);
    };
    const live = () => {
      if (ended || client.readyState !== WebSocket.OPEN) throw new Error('Viewer disconnected.');
      context?.authorize();
      if (!context || context.key?.scope !== 'viewer' || isTeamAuthority() || !team || !isCurrentTeam(team)) throw new Error('Connection changed.');
    };
    const signedOut = () => {
      if (ended) return;
      if (team) recordTeamFailure(teamId, new TeamRequestError('signed_out', teamProblemMessage('signed_out', team.connection.name), 401), team);
      // A team sign-out must never sign the viewer out of their personal Home.
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id: null, error: {
        code: -32003, message: 'The team no longer accepts this Home’s sign-in.',
        data: { code: 'FORBIDDEN', httpStatus: 403, domainCode: 'team_signed_out' },
      } }));
      end(4403, 'The team sign-in ended.');
    };
    const send = (text: string) => {
      live();
      if (upstream?.readyState !== WebSocket.OPEN || upstream.bufferedAmount + Buffer.byteLength(text) > INPUT_LIMIT) throw new Error('The team connection cannot accept input.');
      upstream.send(text);
    };
    const open = async (first: string) => {
      let params: Record<string, string | undefined> | null = null;
      let isParams = false;
      try {
        const message = JSON.parse(first) as { method?: unknown; data?: Record<string, unknown> };
        isParams = message.method === 'connectionParams';
        if (isParams) params = { token: typeof message.data?.token === 'string' ? message.data.token : undefined, protocol: typeof message.data?.protocol === 'string' ? message.data.protocol : undefined, documentHome: typeof message.data?.documentHome === 'string' ? message.data.documentHome : undefined, documentViewer: typeof message.data?.documentViewer === 'string' ? message.data.documentViewer : undefined };
        context = createWebSocketContext(request, params);
        if (context.key?.scope !== 'viewer' || isTeamAuthority()) throw new Error('Only the personal owner can open a connected team.');
      } catch { end(4401, 'Sign in to your Home.'); return; }
      try {
        team = await teamFor(teamId);
        if (team && !documentBindingMatches(params ? {homeId:params.documentHome,viewerId:params.documentViewer} : null, {homeId:team.connection.id,viewerId:team.connection.memberId})) throw new Error('This document belongs to another team sign-in.');
        live();
        const url = new URL(team!.connection.url);
        url.pathname = '/api/trpc/ws'; url.search = '?connectionParams=1'; url.hash = '';
        url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
        if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid team address.');
        upstream = new WebSocket(url, { headers: { authorization: 'Bearer ' + team!.token, [API_PROTOCOL_HEADER]: String(API_PROTOCOL) },
          maxPayload: OUTPUT_LIMIT, perMessageDeflate: false, followRedirects: false, handshakeTimeout: 8_000 });
        checks.set(client, live);
        upstream.on('error', () => end(1011, 'The team cannot be reached.'));
        upstream.on('unexpected-response', (_req, response) => { response.resume(); if (response.statusCode === 401) signedOut(); else end(1011, 'The team refused this connection.'); });
        upstream.on('close', code => { if (code === 4401) signedOut(); else end(code === 1012 ? 1012 : 1011, 'The team connection closed.'); });
        upstream.on('message', (data, binary) => {
          if (binary) { end(1003, 'Unsupported team frame.'); return; }
          try { live(); } catch { end(4403, 'The Home or team sign-in changed.'); return; }
          const text = data.toString();
          let safe: string;
          try {
            const parsed = JSON.parse(text) as unknown;
            const replies = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ error?: { code?: number; data?: { httpStatus?: number } } } | null>;
            if (replies.some(reply => reply?.error?.code === -32001 || reply?.error?.data?.httpStatus === 401)) { signedOut(); return; }
            safe = JSON.stringify(parsed, (_name, value) => typeof value === 'string' ? value.split(team!.token).join('[redacted]') : value);
          } catch { safe = text.split(team!.token).join('[redacted]'); /* PING and PONG are protocol frames. */ }
          if (client.bufferedAmount + Buffer.byteLength(safe) > OUTPUT_LIMIT) { end(1013, 'Team output is catching up. Reconnect.'); return; }
          if (client.readyState === WebSocket.OPEN) client.send(safe);
        });
        upstream.once('open', () => {
          try {
            live(); clearTimeout(deadline);
            // Never forward the browser's personal token or other headers.
            upstream!.send(JSON.stringify({ method: 'connectionParams', data: { token: team!.token, protocol: String(API_PROTOCOL), documentHome: team!.connection.id, documentViewer: team!.connection.memberId } }));
            if (!isParams) send(first);
            for (const text of pending) send(text);
            pending = []; pendingBytes = 0;
          } catch { end(4403, 'The Home or team sign-in changed.'); }
        });
      } catch { end(4403, 'This team is no longer connected to your Home.'); }
    };
    client.on('message', (data, binary) => {
      if (binary) { end(1003, 'Unsupported frame.'); return; }
      const text = data.toString();
      if (!opening) { opening = true; void open(text); return; }
      if (ended) return;
      try {
        // Re-authentication cannot replace this socket's original principal.
        if (text.includes('connectionParams') && (() => { try { return JSON.parse(text).method === 'connectionParams'; } catch { return false; } })()) throw new Error('Duplicate connection parameters.');
        if (upstream?.readyState === WebSocket.OPEN) send(text);
        else {
          pendingBytes += Buffer.byteLength(text);
          if (pendingBytes > 512 * 1024 || pending.length >= 256) throw new Error('Too much pending input.');
          pending.push(text);
        }
      } catch { end(4403, 'The team connection cannot accept this request.'); }
    });
    client.once('close', () => end(1000, 'Viewer disconnected.'));
    client.once('error', () => end(1011, 'Viewer connection failed.'));
  }

  return {
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, request: Request, teamId: string) {
      if (closing || isTeamAuthority() || request.headers.has(SESSION_CREDENTIAL_HEADER)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      server.handleUpgrade(req, socket, head, client => attach(client, request, teamId));
    },
    async close() {
      if (closing) return; closing = true; clearInterval(sweep);
      for (const client of server.clients) client.close(1012, 'Home is restarting.');
      const force = setTimeout(() => { for (const client of server.clients) client.terminate(); }, 1_000); force.unref();
      await new Promise<void>(resolve => server.close(() => resolve())); clearTimeout(force);
    },
  };
}
