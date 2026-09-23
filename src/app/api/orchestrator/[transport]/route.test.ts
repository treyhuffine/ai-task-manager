import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The orchestrator MCP route resolves the calling chat from the signed
 * `x-ri-session` header (docs/agents-view-spec.md Phase 4, "Caller
 * identity"). Driven through the real MCP handler with a JSON-RPC tools/call.
 * The observable effect: `send_session_message` refuses a chat messaging
 * itself, which it can only know when the route resolved the caller.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-orchestrator-mcp-'));
const TOKEN = 'tok_orchestrator_mcp';
const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH, config: process.env.RI_CONFIG_DIR };

const serverFetch = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
vi.mock('@/lib/orchestrator/server-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator/server-client')>();
  return { ...actual, serverFetch: (p: string, init?: RequestInit) => serverFetch(p, init) };
});

beforeAll(async () => {
  process.env.RI_ROOT = ROOT;
  process.env.RI_DB_PATH = path.join(ROOT, 'data.db');
  process.env.RI_CONFIG_DIR = path.join(ROOT, '.config');
  fs.mkdirSync(process.env.RI_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.RI_CONFIG_DIR, 'config.json'), JSON.stringify({ version: 1, localToken: TOKEN }));
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
});

afterAll(() => {
  for (const [key, value] of [['RI_ROOT', saved.root], ['RI_DB_PATH', saved.db], ['RI_CONFIG_DIR', saved.config]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  serverFetch.mockReset();
  serverFetch.mockResolvedValue({ id: 'evt-1' });
});

async function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { POST } = await import('./route');
  const response = await POST(new Request('http://127.0.0.1/api/orchestrator/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const raw = await response.text();
  // Streamable HTTP answers as a single SSE `data:` frame or plain JSON.
  const json = raw.includes('data:')
    ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
    : raw;
  const message = JSON.parse(json) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(message.result.content[0].text) as { ok: boolean; error?: { code: string; message: string } };
}

async function seedExecution() {
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({ name: 'ri', cwd: ROOT, isGit: false, filesToCopy: [], status: 'active' });
  return q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Work' }).session;
}

describe('orchestrator MCP caller identity', () => {
  it('resolves a signed header to the calling chat', async () => {
    const session = await seedExecution();
    const { sessionCredential } = await import('@/lib/orchestrator/session-credential');
    const envelope = await callTool('send_session_message', { sessionId: session.id, content: 'hi' }, {
      'x-ri-session': sessionCredential(session.id)!,
    });
    expect(envelope).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(envelope.error!.message).toContain('own session');
    expect(serverFetch).not.toHaveBeenCalled();
  });

  it('ignores a forged or bare session id, so the call runs with no actor', async () => {
    const session = await seedExecution();
    for (const header of [`${session.id}.forged`, session.id]) {
      serverFetch.mockClear();
      const envelope = await callTool('send_session_message', { sessionId: session.id, content: 'hi' }, {
        'x-ri-session': header,
      });
      expect(envelope.ok).toBe(true);
      expect(serverFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('runs with no actor when the header is absent', async () => {
    const session = await seedExecution();
    const envelope = await callTool('send_session_message', { sessionId: session.id, content: 'hi' });
    expect(envelope.ok).toBe(true);
  });
});
