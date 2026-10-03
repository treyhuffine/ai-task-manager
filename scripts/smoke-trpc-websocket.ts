/** Run with `pnpm iso <temp-root> -- pnpm exec tsx scripts/smoke-trpc-websocket.ts <origin>`.
 * The same isolated Home must already be running. Never accepts a real Home. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { ApiClient } from '../src/lib/api/client';
import { readAuthConfig } from '../src/lib/auth/config-file';
import { getAppRoot } from '../src/lib/config/paths';
import { createAppTRPCClient } from '../src/lib/trpc/client';
import { getTransportStatus, type TransportMode } from '../src/lib/trpc/transport-state';

async function main() {
  const root = getAppRoot();
  assert(process.env.RI_ROOT, 'Use pnpm iso with a temporary Home');
  assert([os.tmpdir(), '/tmp'].some(dir => fs.existsSync(dir) && fs.realpathSync(root).startsWith(fs.realpathSync(dir) + path.sep)), 'Only a Home under a system temporary directory is accepted');
  const config = readAuthConfig();
  assert(config?.globalSkillEnabled === false && config.localToken, 'Use an isolated Home with machine-wide skills disabled');
  const origin = new URL(process.argv[2]);
  assert(['http:', 'https:'].includes(origin.protocol));
  let mode: TransportMode = 'websocket';
  const client = createAppTRPCClient({ url: `${origin.origin}/api/trpc`, transport: new ApiClient({ getToken: () => config.localToken! }),
    getMode: () => mode, WebSocket: WebSocket as unknown as typeof globalThis.WebSocket });
  const capabilities = await client.transport.capabilities.query(undefined, { context: { httpOnly: true } });
  assert(capabilities.websocket, 'The running Home must use the shared WebSocket server');
  // The HTTP route has published its bundle's router. Auth failures from the
  // instrumentation bundle must keep their structured status across that boundary.
  const refused = new WebSocket(`${origin.origin.replace(/^http/, 'ws')}/api/trpc/ws?connectionParams=1`);
  try {
    const error = await new Promise<{ data: { httpStatus: number; body: unknown } }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Protocol refusal timed out')), 5_000);
      refused.once('open', () => {
        refused.send(JSON.stringify({ method: 'connectionParams', data: { token: config.localToken, protocol: '999' } }));
        refused.send(JSON.stringify({ id: 1, method: 'query', params: { path: 'transport.ping' } }));
      });
      refused.once('message', data => { clearTimeout(timeout); resolve(JSON.parse(String(data)).error); });
      refused.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    assert.equal(error.data.httpStatus, 426);
    assert(error.data.body);
  } finally { refused.close(); }
  let taskId: string | undefined;
  let workspaceId: string | undefined;
  let terminalId: string | undefined;
  let stopOutput = () => {};
  const folder = path.join(root, 'websocket-smoke');
  fs.mkdirSync(folder, { recursive: true });
  try {
    const task = await client.tasks.create.mutate({ title: 'WebSocket smoke', rawInput: 'WebSocket smoke', body: '# Verbatim\n\nInitial body' });
    taskId = task.id;
    assert.equal(getTransportStatus().state, 'websocket');
    await client.tasks.update.mutate({ id: task.id, patch: { body: '# Verbatim\n\nSaved over WebSocket' } });
    mode = 'http';
    const detail = await client.tasks.get.query({ id: task.id });
    assert.equal(detail.body, '# Verbatim\n\nSaved over WebSocket');
    assert(!(await client.tasks.list.query()).some(row => row.id === task.id && 'body' in row));
    mode = 'websocket';
    const domains = await Promise.all([client.notes.list.query(), client.areas.list.query(), client.workspaces.list.query({}), client.devices.list.query({}),
      client.userState.list.query({}), client.deck.current.query({ query: { ensure: 'false' } }), client.sessions.railGet.query({}), client.home.info.query({})]);
    assert.equal(domains.length, 8);
    const workspace = await client.workspaces.create.mutate({ body: { name: 'WebSocket smoke', cwd: folder, isGit: false, browserEnabled: false } });
    workspaceId = workspace.id;
    const terminal = await client.workspaces.terminalsPost.mutate({ params: { id: workspace.id }, body: { cols: 80, rows: 24 } });
    terminalId = terminal.id;
    mode = 'http';
    // HTTP must see the PTY made on WS, demonstrating one live runtime.
    const terminals = await client.workspaces.terminalsGet.query({ params: { id: workspace.id } });
    assert(terminals.some(item => item.id === terminal.id));
    mode = 'websocket';
    let text = '', after: number | null = null;
    let ready = () => {}, arrived = () => {};
    const initialized = new Promise<void>(resolve => { ready = resolve; });
    const marker = `RI_WS_SMOKE_${Date.now()}`;
    const output = new Promise<void>(resolve => { arrived = resolve; });
    const subscription = client.terminals.output.subscribe({ base: `/workspaces/${workspace.id}`, terminalId: terminal.id, after: null }, {
      onData({ data: frame }) {
        if (frame.event === 'ready') ready();
        if (frame.id) after = Number(frame.id);
        if (frame.event === 'data') { text += frame.data; if (text.includes(marker)) arrived(); }
      },
      onError(error) { console.error('Terminal subscription failed:', error.message); },
    });
    stopOutput = () => subscription.unsubscribe();
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Terminal smoke timed out')), 15_000); timer.unref(); })]);
    await bounded(initialized);
    const escaped = [...marker + '\n'].map(char => '\\' + char.charCodeAt(0).toString(8).padStart(3, '0')).join('');
    await client.workspaces.terminalsInputTerminalIdPost.mutate({ params: { id: workspace.id, terminalId: terminal.id }, body: { data: `printf '${escaped}'\r` } });
    await bounded(output);
    assert(after !== null);
    stopOutput();
    // Fresh WS subscriber catches up against the same ring without a reset.
    const resumed = new Promise<void>((resolve, reject) => {
      const replay = client.terminals.output.subscribe({ base: `/workspaces/${workspace.id}`, terminalId: terminal.id, after }, {
        onData({ data: frame }) { if (frame.event === 'ready') { try { assert(frame.data.resumed); resolve(); } catch (error) { reject(error); } } }, onError: reject,
      });
      stopOutput = () => replay.unsubscribe();
    });
    await bounded(resumed);
    stopOutput();
    // Direct SSE also resumes the PTY output cursor used by the typed stream.
    const aborter = new AbortController();
    const response = await fetch(`${origin.origin}/api/workspaces/${workspace.id}/terminals/${terminal.id}/stream`, {
      headers: { authorization: `Bearer ${config.localToken}`, 'x-ri-api-protocol': '1', 'last-event-id': String(after) }, signal: aborter.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await bounded(reader.read())).value);
    assert(first.includes('"resumed":true'));
    aborter.abort();
    await reader.cancel().catch(() => {});
    // Warm transport timings include the same server-side ping operation.
    const measure = async (next: TransportMode) => {
      mode = next;
      await client.transport.ping.query();
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) { const start = performance.now(); await client.transport.ping.query(); samples.push(performance.now() - start); }
      samples.sort((a, b) => a - b);
      return { medianMs: Number(samples[15].toFixed(2)), p95Ms: Number(samples[28].toFixed(2)) };
    };
    const http = await measure('http'), websocket = await measure('websocket');
    console.log(JSON.stringify({ ok: true, domains: 9, terminal: 'WS input/output, HTTP visibility, WS/SSE replay', warmPing: { http, websocket } }));
  } finally {
    stopOutput();
    mode = 'http';
    if (workspaceId && terminalId) await client.workspaces.terminalsTerminalIdDelete.mutate({ params: { id: workspaceId, terminalId } }).catch(() => {});
    if (taskId) await client.tasks.delete.mutate({ id: taskId }).catch(() => {});
    if (workspaceId) await client.workspaces.update.mutate({ params: { id: workspaceId }, body: { status: 'archived' } }).catch(() => {});
    await client.closeTransport();
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'WebSocket smoke failed'); process.exitCode = 1; });
