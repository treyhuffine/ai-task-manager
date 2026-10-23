/**
 * Probe: named capability and resource checks on preview operations.
 * Mocked capability table removes one action at a time (same pattern as
 * src/lib/team/capability-conformance.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import type { TeamAction } from '@/lib/team/capabilities';

const policy = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('@/lib/team/capabilities', async original => {
  const actual = await original<typeof import('@/lib/team/capabilities')>();
  return { ...actual, hasTeamCapability: (...args: Parameters<typeof actual.hasTeamCapability>) => !policy.denied.has(args[1]) && actual.hasTeamCapability(...args) };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => { policy.denied.clear(); fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); });
afterEach(async () => { policy.denied.clear(); vi.unstubAllGlobals(); await fixture.cleanup(); });
const deny = (action: TeamAction) => policy.denied.add(action);

it('manual preview URL replacement requires editAgentFolder', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const shared = q.createExecutionWithChat({ label: 'Shared', workspaceId: fixture.workspace.id, harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id, worktreePath: fixture.workspace.cwd });
  deny('editAgentFolder');
  // Control: the other preview writes refuse.
  await expect(client.executions.previewPinPost.mutate({ params: { id: shared.execution.id }, body: {} })).rejects.toThrow(/cannot perform/);
  let outcome: unknown;
  try { outcome = await client.executions.previewUrlsPut.mutate({ params: { id: shared.execution.id }, body: { urls: [{ url: 'https://attacker.example/', label: 'Preview' }] } }); }
  catch (error) { outcome = error instanceof Error ? `threw: ${error.message}` : error; }
  expect.soft(String(outcome)).toMatch(/threw: .*cannot perform/);
});

it('workspace preview list and restore exclude non-shared executions', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const worktree = path.join(fixture.home.root, 'personal-worktree'); fs.mkdirSync(worktree);
  const personal = q.createExecutionWithChat({ label: 'Private execution label', workspaceId: fixture.workspace.id, harness: 'claude', worktreePath: worktree });
  q.createPreviewTarget({ executionId: personal.execution.id, service: null, previewName: 'private-preview', port: 45999, pinned: true });
  const shared = q.createExecutionWithChat({ label: 'Shared preview', workspaceId: fixture.workspace.id, harness: 'claude', worktreePath: fixture.workspace.cwd, surfaceKind: q.TEAM_CHAT_SURFACE });
  q.createPreviewTarget({ executionId: shared.execution.id, service: null, previewName: 'shared-preview', port: 45998, pinned: true });
  // Control: direct per-execution routes refuse the non-shared execution.
  await expect(client.executions.previewStatusGet.query({ params: { id: personal.execution.id } })).rejects.toThrow(/shared Team executions/);
  const listed = await client.workspaces.previewsGet.query({ params: { id: fixture.workspace.id } }) as { previews: Array<{ executionId?: string; label: string | null }> };
  expect.soft(JSON.stringify(listed)).not.toContain(personal.execution.id);
  expect.soft(JSON.stringify(listed)).not.toContain('Private execution label');
  expect(listed.previews.some(preview => preview.executionId === shared.execution.id)).toBe(true);
  const restored = await client.workspaces.previewRestoreSetPost.mutate({ params: { id: fixture.workspace.id }, body: {} }) as { results: Array<{ executionId: string }> };
  expect.soft(restored.results.map(r => r.executionId)).not.toContain(personal.execution.id);
  expect(restored.results.map(r => r.executionId)).toContain(shared.execution.id);
});

it('records manual preview changes under the member who made them', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const shared = q.createExecutionWithChat({ label: 'Shared', workspaceId: fixture.workspace.id, harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, worktreePath: fixture.workspace.cwd });
  await client.executions.previewUrlsPut.mutate({ params: { id: shared.execution.id }, body: { urls: [{ url: 'https://preview.example.invalid/' }] } });
  expect(q.listTeamActivity(fixture.workspace.id)).toMatchObject([{ kind: 'preview_change', operation: 'set_preview_urls', memberId: fixture.member.member.id, apiKeyId: fixture.member.key.id }]);
});
