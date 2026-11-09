import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let q: typeof import('@/lib/db/queries');
let list: typeof import('./execution-artifacts')['listExecutionArtifacts'];
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-execution-artifacts-' });
  q = await import('@/lib/db/queries');
  list = (await import('./execution-artifacts')).listExecutionArtifacts;
});
afterEach(async () => { await home.cleanup(); });

function execution() {
  const workspace = q.createWorkspace({ name: 'Research', cwd: '/tmp/research', isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  return q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Research' });
}
function share(sessionId: string, content: string, at = '2026-11-01T12:00:00Z') {
  return q.insertChatEvent({ sessionId, role: 'assistant', source: 'agent', content, createdAt: at })!;
}

it('includes old and current chats, keeps the source chat, and resolves duplicate identities', () => {
  const first = execution();
  const next = q.createExecutionChat({ executionId: first.execution.id, harness: 'codex', label: 'Follow-up' })!;
  share(first.session.id, '[Report](./out/report.pdf)');
  q.updateChatSession(first.session.id, { status: 'archived' });
  share(next.id, '[Report](/tmp/research/out/report.pdf)', '2026-11-02T12:00:00Z');
  share(execution().session.id, '[Private](/tmp/private.pdf)');
  const result = list(next.id);
  expect(result.items).toHaveLength(2);
  expect(new Set(result.items.map(item => item.key)).size).toBe(1);
  expect(result.items.map(item => item.sessionId)).toEqual([next.id, first.session.id]);
  expect(result.items[1].source).toEqual({ kind: 'session', sessionId: first.session.id, path: './out/report.pdf' });
  expect(list(first.session.id)).toEqual(result);
});

it('includes message attachments while excluding user paths, thinking and tool activity', () => {
  const { session } = execution();
  q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Read /tmp/private.md', attachments: [{ fileName: 'upload.pdf', originalName: 'Brief.pdf', size: 100, mimeType: 'application/pdf', uploadedAt: '2026-11-01T00:00:00Z' }] });
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'thinking', content: '/tmp/thinking.md' });
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'tool_call', toolName: 'Read', toolInput: { file_path: '/tmp/tool.md' } });
  expect(list(session.id).items).toMatchObject([{ name: 'Brief.pdf', source: { kind: 'attachment', fileName: 'upload.pdf' }, sessionId: session.id }]);
});

it('pages across chats without gaps at identical timestamps and excludes hidden chats before paging', () => {
  const first = execution();
  const second = q.createExecutionChat({ executionId: first.execution.id, harness: 'codex' })!;
  for (let i = 0; i < 70; i++) share(i % 2 ? first.session.id : second.id, `[Report](out/report-${i}.pdf)`);
  const page = list(first.session.id);
  expect(page.items).toHaveLength(50);
  expect(page.nextCursor).not.toBeNull();
  const older = list(first.session.id, page.nextCursor!);
  expect(older.items).toHaveLength(20);
  expect(older.nextCursor).toBeNull();
  expect(new Set([...page.items, ...older.items].map(item => item.eventId)).size).toBe(70);
  const visible = list(first.session.id, undefined, chat => chat.id !== second.id);
  expect(visible.items).toHaveLength(35);
  expect(visible.items.every(item => item.sessionId === first.session.id)).toBe(true);
});

it('uses a direct partial-index seek with no temporary sort', async () => {
  const { session } = execution();
  const { getRawDb } = await import('@/lib/db');
  const query = getRawDb().prepare(`EXPLAIN QUERY PLAN SELECT id, content, attachments FROM chat_events INDEXED BY idx_chat_events_artifact_message
    WHERE session_id = ? AND (source = 'agent' OR attachments <> '[]') AND (created_at, id) < (?, ?)
    ORDER BY created_at DESC, id DESC LIMIT 51`).all(session.id, '2026-11-01T00:00:00Z', 'cursor') as { detail: string }[];
  expect(query.map(row => row.detail).join('\n')).toContain('USING INDEX idx_chat_events_artifact_message (session_id=? AND (created_at,id)<(?,?))');
  expect(query.some(row => row.detail.includes('TEMP B-TREE'))).toBe(false);
});
