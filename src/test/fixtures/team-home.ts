/**
 * A team space in this test process (docs/homes-spec.md §9), reached through
 * the real proxy and route handlers: in-process with `serve`, or over real
 * HTTP with `listen`, for a client in another process (the MCP of a real
 * Claude Code binary).
 *
 * Test files mock what they need themselves (vi.mock is per file): the
 * `ai`/one-shot entry points they watch, and the personal workstream.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { ApiClient } from '@/lib/api/client';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

type Handler = (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>;

export const TEAM_ROUTES: Array<[RegExp, () => Promise<RouteModule>]> = [
  [/^\/api\/transcribe$/, () => import('@/app/api/transcribe/route') as unknown as Promise<RouteModule>],
  [/^\/api\/orchestrator\/actions\/([^/]+)$/, () => import('@/app/api/orchestrator/actions/[name]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/tasks\/([^/]+)\/continue-targets$/, () => import('@/app/api/tasks/[id]/continue-targets/route') as unknown as Promise<RouteModule>],
  [/^\/api\/skills\/([^/]+)\/move$/, () => import('@/app/api/skills/[ref]/move/route') as unknown as Promise<RouteModule>],
  [/^\/api\/skills\/([^/]+)\/commit$/, () => import('@/app/api/skills/[ref]/commit/route') as unknown as Promise<RouteModule>],
  [/^\/api\/skills\/([^/]+)$/, () => import('@/app/api/skills/[ref]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/skills$/, () => import('@/app/api/skills/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pr-link$/, () => import('@/app/api/sessions/[id]/pr-link/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/previews$/, () => import('@/app/api/workspaces/[id]/previews/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/preview\/restore-set$/, () => import('@/app/api/workspaces/[id]/preview/restore-set/route') as unknown as Promise<RouteModule>],
  [/^\/api\/executions\/([^/]+)\/preview\/status$/, () => import('@/app/api/executions/[id]/preview/status/route') as unknown as Promise<RouteModule>],
  [/^\/api\/executions\/([^/]+)\/preview\/start$/, () => import('@/app/api/executions/[id]/preview/start/route') as unknown as Promise<RouteModule>],
  [/^\/api\/executions\/([^/]+)\/preview\/stop$/, () => import('@/app/api/executions/[id]/preview/stop/route') as unknown as Promise<RouteModule>],
  [/^\/api\/executions\/([^/]+)\/preview\/logs$/, () => import('@/app/api/executions/[id]/preview/logs/route') as unknown as Promise<RouteModule>],
  [/^\/api\/executions\/([^/]+)\/preview\/pin$/, () => import('@/app/api/executions/[id]/preview/pin/route') as unknown as Promise<RouteModule>],
  [/^\/api\/executions\/([^/]+)\/preview-urls$/, () => import('@/app/api/executions/[id]/preview-urls/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/commit$/, () => import('@/app/api/sessions/[id]/commit/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pr$/, () => import('@/app/api/sessions/[id]/pr/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/help-with-error$/, () => import('@/app/api/sessions/[id]/help-with-error/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/resolve-conflicts$/, () => import('@/app/api/sessions/[id]/resolve-conflicts/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/push$/, () => import('@/app/api/sessions/[id]/push/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pull-base$/, () => import('@/app/api/sessions/[id]/pull-base/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pull-upstream$/, () => import('@/app/api/sessions/[id]/pull-upstream/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/background-tasks$/, () => import('@/app/api/sessions/[id]/background-tasks/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/slash-commands$/, () => import('@/app/api/sessions/[id]/slash-commands/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/archive$/, () => import('@/app/api/sessions/[id]/archive/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/continue$/, () => import('@/app/api/sessions/[id]/continue/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/retry-setup$/, () => import('@/app/api/sessions/[id]/retry-setup/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/retry-setup-script$/, () => import('@/app/api/sessions/[id]/retry-setup-script/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/read$/, () => import('@/app/api/sessions/[id]/read/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/unread$/, () => import('@/app/api/sessions/[id]/unread/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/view$/, () => import('@/app/api/sessions/[id]/view/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pin$/, () => import('@/app/api/sessions/[id]/pin/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/unpin$/, () => import('@/app/api/sessions/[id]/unpin/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/scratchpad$/, () => import('@/app/api/sessions/[id]/scratchpad/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/reconcile$/, () => import('@/app/api/sessions/[id]/reconcile/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/new-chat$/, () => import('@/app/api/sessions/[id]/new-chat/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/close-chat$/, () => import('@/app/api/sessions/[id]/close-chat/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/history$/, () => import('@/app/api/sessions/[id]/history/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/entities$/, () => import('@/app/api/sessions/[id]/entities/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/picker$/, () => import('@/app/api/sessions/[id]/picker/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/references$/, () => import('@/app/api/sessions/[id]/references/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/history$/, () => import('@/app/api/sessions/history/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/search$/, () => import('@/app/api/sessions/search/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/needs-review$/, () => import('@/app/api/sessions/needs-review/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pending-input$/, () => import('@/app/api/sessions/[id]/pending-input/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/pending-input\/([^/]+)$/, () => import('@/app/api/sessions/[id]/pending-input/[requestId]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/rail$/, () => import('@/app/api/sessions/rail/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/run-on$/, () => import('@/app/api/workspaces/[id]/run-on/route') as unknown as Promise<RouteModule>],
  [/^\/api\/harness\/auth$/, () => import('@/app/api/harness/auth/route') as unknown as Promise<RouteModule>],
  [/^\/api\/harness\/harnesses$/, () => import('@/app/api/harness/harnesses/route') as unknown as Promise<RouteModule>],
  [/^\/api\/harness\/models$/, () => import('@/app/api/harness/models/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/chat$/, () => import('@/app/api/workspaces/[id]/chat/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/chat\/new$/, () => import('@/app/api/workspaces/[id]/chat/new/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/chat\/history$/, () => import('@/app/api/workspaces/[id]/chat/history/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/chat\/resume$/, () => import('@/app/api/workspaces/[id]/chat/resume/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/tree$/, () => import('@/app/api/sessions/[id]/tree/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/file$/, () => import('@/app/api/sessions/[id]/file/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/status$/, () => import('@/app/api/sessions/[id]/status/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/diff$/, () => import('@/app/api/sessions/[id]/diff/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/diff-stats$/, () => import('@/app/api/sessions/[id]/diff-stats/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/wip$/, () => import('@/app/api/sessions/[id]/wip/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/tree$/, () => import('@/app/api/workspaces/[id]/tree/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/file$/, () => import('@/app/api/workspaces/[id]/file/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/terminals$/, () => import('@/app/api/sessions/[id]/terminals/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/terminals\/([^\/]+)$/, () => import('@/app/api/sessions/[id]/terminals/[terminalId]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/terminals\/([^\/]+)\/input$/, () => import('@/app/api/sessions/[id]/terminals/[terminalId]/input/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/terminals\/([^\/]+)\/resize$/, () => import('@/app/api/sessions/[id]/terminals/[terminalId]/resize/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/terminals$/, () => import('@/app/api/workspaces/[id]/terminals/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/terminals\/([^\/]+)$/, () => import('@/app/api/workspaces/[id]/terminals/[terminalId]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/terminals\/([^\/]+)\/input$/, () => import('@/app/api/workspaces/[id]/terminals/[terminalId]/input/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/terminals\/([^\/]+)\/resize$/, () => import('@/app/api/workspaces/[id]/terminals/[terminalId]/resize/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)$/, () => import('@/app/api/sessions/[id]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/events$/, () => import('@/app/api/sessions/[id]/events/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/messages$/, () => import('@/app/api/sessions/[id]/messages/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/runtime-status$/, () => import('@/app/api/sessions/[id]/runtime-status/route') as unknown as Promise<RouteModule>],
  [/^\/api\/sessions\/([^/]+)\/interrupt$/, () => import('@/app/api/sessions/[id]/interrupt/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)$/, () => import('@/app/api/workspaces/[id]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/archive$/, () => import('@/app/api/workspaces/[id]/archive/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/sessions$/, () => import('@/app/api/workspaces/[id]/sessions/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces\/([^/]+)\/tasks$/, () => import('@/app/api/workspaces/[id]/tasks/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workspaces$/, () => import('@/app/api/workspaces/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workers\/enroll$/, () => import('@/app/api/workers/enroll/route') as unknown as Promise<RouteModule>],
  [/^\/api\/workers\/me\/heartbeat$/, () => import('@/app/api/workers/me/heartbeat/route') as unknown as Promise<RouteModule>],
  [/^\/api\/trpc\//, () => import('@/app/api/trpc/[trpc]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/mcp$/, () => import('@/app/api/team/mcp/route') as unknown as Promise<RouteModule>],
  [/^\/api\/attachments$/, () => import('@/app/api/attachments/route') as unknown as Promise<RouteModule>],
  [/^\/api\/attachments\/([^/]+)$/, () => import('@/app/api/attachments/[fileName]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/join$/, () => import('@/app/api/team/public/join/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/owner$/, () => import('@/app/api/team/host/owner/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/status$/, () => import('@/app/api/team/host/status/route') as unknown as Promise<RouteModule>],
  [/^\/api\/session$/, () => import('@/app/api/session/route') as unknown as Promise<RouteModule>],
];

/** Load the proxy, routes and tRPC stack once per file. */
export async function preloadTeamRoutes(): Promise<void> {
  await Promise.all([import('@/proxy'), import('@/lib/trpc/client'), ...TEAM_ROUTES.map(([, load]) => load())]);
}

/** One request through the real proxy and, when it lets it through, the real route. */
export async function serveTeam(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const source = input instanceof Request ? input : null;
  const request = new NextRequest(source ? source.url : String(input), {
    method: init?.method ?? source?.method,
    headers: init?.headers ?? source?.headers,
    body: init?.body ?? (source && source.method !== 'GET' && source.method !== 'HEAD' ? await source.arrayBuffer() : undefined),
    signal: init?.signal ?? undefined,
  });
  const { proxy } = await import('@/proxy');
  const auth = proxy(request);
  if (auth.headers.get('x-middleware-next') !== '1') return auth;
  const headers = new Headers(request.headers);
  for (const [name, value] of auth.headers) {
    if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
  }
  const path = new URL(request.url).pathname;
  const route = TEAM_ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return Response.json({ error: 'no route in this test' }, { status: 599 });
  const mod = await route[1]();
  const handler = mod[request.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'];
  if (!handler) return Response.json({ error: 'method' }, { status: 405 });
  const captured = route[0].exec(path)?.[1] ?? '';
  const params = Promise.resolve<Record<string, string>>(path.startsWith('/api/orchestrator/actions/') ? { name: captured } : /^\/api\/(workspaces|sessions|tasks)\//.test(path) ? { id: captured, ...(route[0].exec(path)?.[2] ? { [path.includes('/pending-input/') ? 'requestId' : 'terminalId']: route[0].exec(path)![2] } : {}) } : { fileName: captured });
  return handler(new NextRequest(request, { headers }), { params });
}

/** The same, over real HTTP on a free port. */
export async function listenTeam(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (Array.isArray(value)) headers.set(name, value.join(', '));
      }
      const address = server.address() as AddressInfo;
      const response = await serveTeam(`http://127.0.0.1:${address.port}${req.url}`, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        signal: controller.signal,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      // MCP can keep a response open. Waiting for arrayBuffer() withheld even
      // its headers, so real clients hung before initializing their tools.
      res.flushHeaders();
      if (response.body) {
        const reader = response.body.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || res.destroyed) break;
            if (!res.write(value)) await new Promise<void>(resolve => {
              const ready = () => { res.off('drain', ready); res.off('close', ready); resolve(); };
              res.once('drain', ready); res.once('close', ready);
            });
          }
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          reader.releaseLock();
        }
      }
      res.end();
    } catch (err) {
      if (res.destroyed) return;
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

export const TEAM_BASE = 'http://team.test';

export async function teamPost(path: string, body: unknown, token?: string): Promise<Response> {
  return serveTeam(`${TEAM_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

export async function teamTrpc(token: string) {
  const { createAppTRPCClient } = await import('@/lib/trpc/client');
  return createAppTRPCClient({ url: `${TEAM_BASE}/api/trpc`, transport: new ApiClient({ getToken: () => token, onUnauthorized: () => {} }) });
}

export interface TeamTestHome {
  home: TestHome;
  hostToken: string;
  owner: { token: string; id: string };
  joinAs(name: string): Promise<{ token: string; id: string }>;
  cleanup(): Promise<void>;
}

/** A team named Acme, with its owner Trey signed in. `fetch` reaches it in-process. */
export async function createTeamTestHome(prefix = 'ri-team-'): Promise<TeamTestHome> {
  const home = await createTestHome({ prefix, openDb: false });
  const { writeTeamIntent } = await import('@/lib/home/team-intent');
  writeTeamIntent({ creationId: 'team-create-1', name: 'Acme' });
  const { resetHomeIdentityCache, ensureHomeIdentity } = await import('@/lib/home/identity');
  const { resetAuthorityCache } = await import('@/lib/home/authority');
  resetHomeIdentityCache();
  resetAuthorityCache();
  ensureHomeIdentity();
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  const hostToken = ensureLocalToken().plaintext;
  const made = await teamPost('/api/team/host/owner', { creationId: 'team-create-1', ownerName: 'Trey' }, hostToken);
  if (made.status !== 200) throw new Error(`team owner: ${made.status}`);
  const body = (await made.json()) as { token: string; member: { id: string } };
  const owner = { token: body.token, id: body.member.id };
  return {
    home,
    hostToken,
    owner,
    async joinAs(name) {
      const link = (await (await teamTrpc(owner.token)).team.invitations.create.mutate()).link;
      const response = await teamPost('/api/team/public/join', { secret: new URL(link).hash.split('=')[1], name });
      if (response.status !== 200) throw new Error(`join: ${response.status}`);
      const joined = (await response.json()) as { token: string; member: { id: string } };
      return { token: joined.token, id: joined.member.id };
    },
    async cleanup() {
      (await import('@/lib/home/identity')).resetHomeIdentityCache();
      (await import('@/lib/home/authority')).resetAuthorityCache();
      await home.cleanup();
    },
  };
}
