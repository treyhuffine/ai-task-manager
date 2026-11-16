import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { teamRequest, teamTRPC } from '@/lib/spaces/remote';
import { connectTeam } from '@/lib/spaces/connect';
import { POST as relay } from '@/app/api/space/[teamId]/[...path]/route';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { feedbackRouter } from './router';
let home: TestHome;
let team: TeamProcess;
let teamRoot: string;
const viewer = {
  scope: 'viewer',
  location: 'home',
  apiKeyId: 'fixture',
  workerDeviceId: null,
  sessionChatId: null,
} as const;
const value = () => ({
  kind: 'bug' as const,
  message: 'Something went wrong',
  includeDiagnostics: false,
});
beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-feedback-team-'));
  team = await startTeamProcess(teamRoot, 'Feedback team', 'Owner');
}, 90_000);
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-feedback-personal-' });
  ensureHomeIdentity();
});
afterEach(async () => {
  await home.cleanup();
});
afterAll(async () => {
  await team?.stop();
  fs.rmSync(teamRoot, { recursive: true, force: true });
});
it('allows a personal viewer to prepare GitHub feedback and refuses worker callers', async () => {
  const caller = feedbackRouter.createCaller({
    request: new Request('http://personal.test'),
    key: viewer,
  });
  const issue = await caller.preparePublicIssue(value());
  expect(issue.body).toBe(value().message);
  expect(issue.githubIssueUrl).toContain('github.com/dynamismlabs/ri/issues/new');
  expect(fs.existsSync(path.join(home.root, 'feedback'))).toBe(false);
  const worker = feedbackRouter.createCaller({
    request: new Request('http://personal.test'),
    key: { ...viewer, scope: 'worker' },
  });
  await expect(worker.preparePublicIssue(value())).rejects.toThrow();
});
it('prepares the same GitHub destination from a direct Team sign-in with Team-hosted files', async () => {
  const form = new FormData();
  form.append('file', new File(['team screenshot'], 'screen.txt', { type: 'text/plain' }));
  const upload = await teamRequest(team.url + '/api/attachments', {
    method: 'POST',
    token: team.ownerToken,
    body: form,
  });
  expect(upload.status).toBe(201);
  const attachment = await upload.json();
  const issue = await teamTRPC(team.url, team.ownerToken).feedback.preparePublicIssue.mutate({
    ...value(),
    attachments: [attachment],
  });
  expect(issue.githubIssueUrl).toContain('github.com/dynamismlabs/ri/issues/new');
  expect(issue.body).toContain('Add the selected files');
  expect(fs.existsSync(path.join(teamRoot, 'attachments', attachment.fileName))).toBe(true);
  expect(fs.existsSync(path.join(teamRoot, 'feedback'))).toBe(false);
});
it('prepares Team feedback and relays its uploads inside My Ri without copying personal data', async () => {
  const owner = teamTRPC(team.url, team.ownerToken);
  const connection = await connectTeam({
    link: (await owner.team.invitations.create.mutate()).link,
    name: 'Reporter',
  });
  const form = new FormData();
  form.append('file', new File(['relayed screenshot'], 'screen.txt', { type: 'text/plain' }));
  const headers = { 'x-ri-api-key-id': 'fixture', 'x-ri-api-key-scope': 'viewer' };
  const upload = await relay(
    new NextRequest(`http://personal.test/api/space/${connection.id}/attachments`, {
      method: 'POST',
      headers,
      body: form,
    }),
    { params: Promise.resolve({ teamId: connection.id, path: ['attachments'] }) },
  );
  expect(upload.status).toBe(201);
  const attachment = await upload.json();
  const response = await relay(
    new NextRequest(
      `http://personal.test/api/space/${connection.id}/trpc/feedback.preparePublicIssue`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ...value(), attachments: [attachment] }),
      },
    ),
    {
      params: Promise.resolve({
        teamId: connection.id,
        path: ['trpc', 'feedback.preparePublicIssue'],
      }),
    },
  );
  expect(response.status).toBe(200);
  const issue = (await response.json()).result.data;
  expect(issue.githubIssueUrl).toContain('github.com/dynamismlabs/ri/issues/new');
  expect(issue.body).not.toContain('App & view info');
  expect(issue.body).not.toContain(connection.memberId);
  expect(fs.existsSync(path.join(home.root, 'attachments', attachment.fileName))).toBe(false);
});
