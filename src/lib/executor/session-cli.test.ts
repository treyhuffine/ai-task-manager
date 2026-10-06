/**
 * `ri` in a session's shell acts on the home that started the session
 * (session-cli.ts). agentex hands a harness only an allowlisted environment,
 * so these run the generated launcher the way a session would: a bare
 * environment, another working folder, with its final `exec` swapped for an
 * echo of what the CLI would see.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import * as q from '@/lib/db/queries';
import { ensureSessionCli, planSessionCli, sessionPath } from './session-cli';
import { buildSessionSpec } from './session-spec';

let home: TestHome;
let elsewhere: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-session-cli-' });
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-session-cli-cwd-'));
});

afterEach(async () => {
  fs.rmSync(elsewhere, { recursive: true, force: true });
  await home.cleanup();
});

/** Run the launcher with its exec replaced, from another folder, with only `env`. */
function runLauncher(env: Record<string, string>): Record<string, string> {
  const plan = planSessionCli();
  if (!plan) throw new Error('expected a CLI entry in this checkout');
  const probe = plan.content.replace(
    /^exec .*$/m,
    'printf "%s\\n" "root=${RI_ROOT:-}" "db=${RI_DB_PATH:-}" "config=${RI_CONFIG_DIR:-}" "work=${RI_WORK_DIR:-}" "repo=${RI_RUNTIME_REPO:-}"',
  );
  const bare = { PATH: '/usr/bin:/bin', ...env } as unknown as NodeJS.ProcessEnv;
  const out = execFileSync('/bin/sh', ['-c', probe], { cwd: elsewhere, env: bare, encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map((line) => {
    const eq = line.indexOf('=');
    return [line.slice(0, eq), line.slice(eq + 1)];
  }));
}

describe('the session CLI launcher', () => {
  // A development server hands out the CLI from source, which every checkout
  // has. The built entry is covered below when this checkout has one.
  const savedNodeEnv = process.env.NODE_ENV;
  beforeEach(() => { (process.env as Record<string, string>).NODE_ENV = 'development'; });
  afterEach(() => { (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv; });

  it('runs a development server\'s CLI from source through the loader, with its own tsconfig', () => {
    const repo = path.resolve(process.cwd());
    const content = planSessionCli()!.content;
    // `node --import`, never the tsx command: its IPC socket fails in Codex's sandbox.
    expect(content).toContain(`'--import' '${path.join(repo, 'node_modules/tsx/dist/loader.mjs')}' '${path.join(repo, 'src/cli/index.ts')}' "$@"`);
    expect(content).toContain(`TSX_TSCONFIG_PATH='${path.join(repo, 'tsconfig.json')}'; export TSX_TSCONFIG_PATH`);
  });

  it.runIf(fs.existsSync(path.join(process.cwd(), 'dist/cli/index.mjs')))('runs the built CLI for a production server', () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(planSessionCli()!.content).toContain(`'${path.join(path.resolve(process.cwd()), 'dist/cli/index.mjs')}' "$@"`);
  });

  it("pins this server's home and checkout when the session's shell has none", () => {
    const seen = runLauncher({});
    expect(seen.root).toBe(home.root);
    expect(seen.db).toBe(home.dbPath);
    expect(seen.config).toBe(home.configDir);
    expect(seen.work).toBe(home.workDir);
    // Migrations come from the server's checkout, not the shell's folder.
    expect(seen.repo).toBe(path.resolve(process.cwd()));
  });

  it('leaves a home the shell chose itself alone', () => {
    const other = path.join(elsewhere, 'other-home');
    const seen = runLauncher({ RI_ROOT: other });
    expect(seen.root).toBe(other);
    expect(seen.db).toBe('');
    expect(seen.config).toBe('');
    expect(seen.work).toBe('');
  });

  it('runs the CLI with the Node that runs the server', () => {
    expect(planSessionCli()!.content).toMatch(new RegExp(`^exec '${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' `, 'm'));
  });

  it('writes an executable launcher in the work folder once, and leaves it while it is current', () => {
    const { binDir, launcher } = ensureSessionCli()!;
    expect(binDir).toBe(path.join(home.workDir, 'bin'));
    expect(launcher).toBe(path.join(binDir, 'ri'));
    expect(fs.statSync(launcher).mode & 0o111).not.toBe(0);
    const before = fs.statSync(launcher).mtimeMs;
    fs.utimesSync(launcher, new Date(before - 60_000), new Date(before - 60_000));
    const stamped = fs.statSync(launcher).mtimeMs;
    ensureSessionCli();
    expect(fs.statSync(launcher).mtimeMs).toBe(stamped);

    fs.writeFileSync(launcher, '#!/bin/sh\nexit 1\n');
    ensureSessionCli();
    expect(fs.readFileSync(launcher, 'utf8')).toBe(planSessionCli()!.content);
  });

  it('puts the launcher folder first on the PATH, once', () => {
    expect(sessionPath('/w/bin', '/usr/bin:/w/bin:/bin')).toBe('/w/bin:/usr/bin:/bin');
    expect(sessionPath('/w/bin', '')).toBe('/w/bin');
  });
});

describe("a home session's spec", () => {
  let fake: FakeHarness;
  beforeEach(() => { fake = installFakeHarness('claude'); });
  afterEach(() => fake.restore());

  it("puts this home's `ri` first on the session's PATH", async () => {
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    const spec = await buildSessionSpec({
      chatSessionId: chat.id, harness: 'claude', cwd: home.root, sessionType: 'orchestration', workspaceId: null,
      surfaceKind: null, surfaceRef: null, existingExternalSessionId: null, permissionMode: 'auto_all',
      prePlanMode: null, model: null, modelVariant: null, effort: null,
    });
    expect(spec.env.PATH?.split(path.delimiter)[0]).toBe(path.join(home.workDir, 'bin'));
    // Named too, for a login shell that rebuilds PATH (Codex runs `zsh -lc`).
    expect(spec.env.RI_SESSION_CLI).toBe(path.join(home.workDir, 'bin', 'ri'));
    expect(fs.existsSync(path.join(home.workDir, 'bin', 'ri'))).toBe(true);
  });
});
