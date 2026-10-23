import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { teamIntentPath } from '@/lib/home/team-intent';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { getDbPath } from '@/lib/config/paths';
import { servicePaths } from '@/lib/service/paths';

const run = promisify(execFile);
it.each(['permissions', 'version'])('actual repair commands work on an existing Team Home with a bad declaration (%s)', async issue => {
  const fixture = await createTeamExecutionFixture();
  const file = teamIntentPath();
  const declaration = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (issue === 'version') declaration.version = -1;
  fs.writeFileSync(file, JSON.stringify(declaration));
  fs.chmodSync(file, issue === 'permissions' ? 0o644 : 0o600);
  const before = fs.readFileSync(getDbPath());
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0' };
  delete env.RI_SESSION_CREDENTIAL; delete env.RI_HOME_TOOLS_URL;
  const paths = servicePaths(), requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ protocol: 1, identity: paths.identity, update: { fixture: true } }));
  });
  await new Promise<void>(resolve => server.listen(paths.socket, resolve));
  const cli = (args: string[]) => run(path.join(process.cwd(), 'node_modules/.bin/tsx'), ['src/cli/index.ts', ...args], { cwd: process.cwd(), env, timeout: 45_000 });
  try {
    const doctor = await cli(['doctor']).catch(error => error as { stdout: string; stderr: string });
    // A diagnostic may report missing optional configuration, but its checks
    // must actually execute rather than stop at registration or the guard.
    expect(doctor.stdout).toContain('Database file');
    expect(doctor.stdout).toContain('Voice');
    expect(doctor.stderr).not.toContain('This folder holds a team');
    const update = await cli(['update', 'status']);
    expect(JSON.parse(update.stdout).update.fixture).toBe(true);
    expect(requests).toEqual(['GET /update']);
    expect((await cli(['agent', '--help'])).stdout).toContain('Usage:');
    await expect(cli(['agent', 'list_tasks'])).rejects.toMatchObject({ stderr: expect.stringContaining('This folder holds a team') });
    expect(fs.readFileSync(getDbPath())).toEqual(before);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(paths.socket, { force: true }); await fixture.cleanup();
  }
}, 120_000);
