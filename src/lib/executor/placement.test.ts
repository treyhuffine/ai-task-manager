import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import * as q from '@/lib/db/queries';
const seams = vi.hoisted(() => ({ local: { id: 'local' }, remote: vi.fn((deviceId: string) => ({ id: deviceId })), sink: vi.fn() }));
vi.mock('@/lib/runner/local-runner', () => ({ localRunner: seams.local }));
vi.mock('./remote-runner', () => ({ remoteRunnerFor: seams.remote }));
vi.mock('./home-sink', () => ({ installHomeSink: seams.sink }));
import { runnerFor } from './placement';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { fixture = await createTeamExecutionFixture(); vi.clearAllMocks(); });
afterEach(async () => { await fixture.cleanup(); });
it('uses the ordinary local runner for Team server placements, including cleanup when AI is off', () => {
  const created = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'codex', label: 'Shared work', surfaceKind: q.TEAM_CHAT_SURFACE });
  q.createPlacement({ executionId: created.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  expect(runnerFor(created.session.id)).toBe(seams.local);
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(runnerFor(created.session.id)).toBe(seams.local);
  expect(seams.remote).not.toHaveBeenCalled(); expect(seams.sink).toHaveBeenCalledTimes(2);
});
it('keeps the ordinary placement resolver for remote personal workers', () => {
  const device = q.createDevice({ name: 'Worker', kind: 'computer' });
  const chat = q.createChatSession({ harness: 'codex', type: 'orchestration', deviceId: device.id });
  expect(runnerFor(chat.id)).toEqual({ id: device.id });
  expect(seams.sink).not.toHaveBeenCalled();
});
