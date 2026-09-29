import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assertDisposableSupervisorAccount, fixtureEnvironment, isWithin, SUPERVISOR_OPT_IN } from './platform-qualification';

let base: string;
let account: string;
let temporary: string;
let env: Partial<NodeJS.ProcessEnv>;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-platform-test-'));
  account = path.join(base, 'account'); temporary = path.join(base, 'runner-temp/test');
  fs.mkdirSync(account); fs.mkdirSync(temporary, { recursive: true });
  env = { RI_SERVICE_SMOKE_SUPERVISOR: SUPERVISOR_OPT_IN, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', CI: 'true', HOME: account, RUNNER_TEMP: path.dirname(temporary) };
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

it('accepts only a distinct disposable fixture in an explicitly opted-in hosted CI account', () => {
  expect(() => assertDisposableSupervisorAccount(env, temporary, account)).not.toThrow();
});
it.each(['RI_SERVICE_SMOKE_SUPERVISOR', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'CI'])('rejects supervision when %s is absent', key => {
  delete env[key];
  expect(() => assertDisposableSupervisorAccount(env, temporary, account)).toThrow('explicitly opted-in');
});
it('rejects self-hosted runners and a substituted login home', () => {
  expect(() => assertDisposableSupervisorAccount({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, temporary, account)).toThrow('disposable');
  expect(() => assertDisposableSupervisorAccount({ ...env, HOME: temporary }, temporary, account)).toThrow('account home');
});
it('rejects escaped, symlinked and non-isolated fixture paths', () => {
  const link = path.join(path.dirname(temporary), 'escape'); fs.symlinkSync(account, link);
  expect(() => assertDisposableSupervisorAccount(env, link, account)).toThrow('RUNNER_TEMP');
  expect(() => assertDisposableSupervisorAccount(env, env.RUNNER_TEMP!, account)).toThrow('RUNNER_TEMP');
  expect(() => assertDisposableSupervisorAccount({ ...env, RUNNER_TEMP: base }, account, account)).toThrow('separate');
  expect(isWithin(path.dirname(temporary), temporary)).toBe(true);
});
it('strips inherited provider keys and unrelated homes while retaining required supervisor plumbing', () => {
  const clean = fixtureEnvironment({ PATH: '/bin', TMPDIR: '/tmp', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus', OPENAI_API_KEY: 'secret', RI_ROOT: '/real-data', RI_CONFIG_DIR: '/real-config', NODE_OPTIONS: '--require=/real-code', HOME: '/real-home' }, { temporary });
  expect(clean.OPENAI_API_KEY).toBeUndefined(); expect(clean.NODE_OPTIONS).toBeUndefined();
  expect(clean.RI_ROOT).toBe(path.join(temporary, 'home')); expect(clean.RI_CONFIG_DIR).toBe(path.join(temporary, 'config'));
  expect(clean.HOME).toBe(path.join(temporary, 'account')); expect(clean.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1/bus');
  expect(fixtureEnvironment({}, { temporary, accountHome: account }).HOME).toBe(account);
});
