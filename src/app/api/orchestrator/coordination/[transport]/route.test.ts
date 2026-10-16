import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import { COORDINATION_TOOLS } from '@/lib/coordination/surface';
import { POST } from './route';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-coordination-mcp-' }); });
afterEach(async () => { await home.cleanup(); });

function list(credential?: string) {
  return POST(new Request('http://localhost/api/orchestrator/coordination/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(credential ? { 'x-ri-session': credential } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
}

describe('native coordination MCP', () => {
  it('requires a verified personal chat, including during discovery', async () => {
    expect((await list()).status).toBe(403);
    expect((await list('forged')).status).toBe(403);
    for (const surfaceKind of ['team_chat', 'result_review']) {
      const chat = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind });
      expect((await list(sessionCredential(chat.id)!)).status).toBe(403);
    }
  });

  it('discovers exactly the focused coordination surface for a signed execution', async () => {
    const workspace = q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false });
    const { session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Work' });
    const response = await list(sessionCredential(session.id)!);
    expect(response.ok).toBe(true);
    const raw = await response.text();
    const message = JSON.parse(raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw);
    expect(message.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([...COORDINATION_TOOLS].sort());
  });
});
