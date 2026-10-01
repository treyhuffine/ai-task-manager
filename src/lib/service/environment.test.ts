import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveEnvironment, environmentStatus, serviceEnvironment, applyServiceEnvironment } from './environment';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-environment-')); vi.stubEnv('RI_ROOT', root); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it('seals keys, returns only configuration status, and loads them into the service', () => {
  saveEnvironment({ GROQ_API_KEY: 'secret-not-in-config-json' });
  expect(fs.readFileSync(path.join(root, '.config/service-environment.json'), 'utf8')).not.toContain('secret-not-in-config-json');
  expect(JSON.stringify(environmentStatus())).not.toContain('secret-not-in-config-json');
  expect(serviceEnvironment('/runtime/node/bin/node').GROQ_API_KEY).toBe('secret-not-in-config-json');
  saveEnvironment({ OPENAI_API_KEY: 'embedding-secret' });
  expect(environmentStatus().secrets).toEqual({ GROQ_API_KEY: true, OPENAI_API_KEY: true });
});
it('keeps the bundled Node before discovered tool directories', () => {
  fs.mkdirSync(path.join(root, '.nvm/versions/node/v22/bin'), { recursive: true });
  const env = serviceEnvironment('/runtime/node/bin/node', { NODE_ENV: 'production', HOME: root, PATH: '/usr/bin:/bin' });
  expect(env.PATH?.split(':')[0]).toBe('/runtime/node/bin');
  expect(env.PATH).toContain('/opt/homebrew/bin');
  expect(env.PATH).toContain('.nvm/versions/node/v22/bin');
});
it('rejects unknown variables and refuses an unreadable encryption key', () => {
  expect(() => saveEnvironment({ NODE_OPTIONS: '--require malicious' })).toThrow();
  saveEnvironment({ GROQ_API_KEY: 'secret' }); fs.unlinkSync(path.join(root, '.config/service-environment.key'));
  expect(() => saveEnvironment({ OPENAI_API_KEY: 'another' })).toThrow();
});
it('reports an explicitly cleared inherited key as disabled', () => {
  vi.stubEnv('GROQ_API_KEY', 'inherited-secret');
  vi.stubEnv('OPENAI_API_KEY', 'inherited-embedding-key');
  expect(environmentStatus().secrets).toEqual({ GROQ_API_KEY: true, OPENAI_API_KEY: true });
  saveEnvironment({ GROQ_API_KEY: null, OPENAI_API_KEY: null });
  expect(environmentStatus().secrets).toEqual({ GROQ_API_KEY: false, OPENAI_API_KEY: false });
  expect(serviceEnvironment('/runtime/node/bin/node')).not.toHaveProperty('GROQ_API_KEY');
});
it('removes explicitly disabled credentials from the current CLI environment', () => {
  saveEnvironment({ GROQ_API_KEY: null, OPENAI_API_KEY: '', CLAUDE_COMMAND: null });
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', GROQ_API_KEY: 'inherited-secret', OPENAI_API_KEY: 'inherited-key', CLAUDE_COMMAND: '/old/claude', HOME: root, PATH: '/usr/bin', RETAINED: 'yes' };
  applyServiceEnvironment('/runtime/node/bin/node', env);
  expect(env).not.toHaveProperty('GROQ_API_KEY');
  expect(env).not.toHaveProperty('OPENAI_API_KEY');
  expect(env).not.toHaveProperty('CLAUDE_COMMAND');
  expect(env).toMatchObject({ HOME: root, RETAINED: 'yes' });
  expect(env.PATH?.split(':')[0]).toBe('/runtime/node/bin');
});
it('takes an absolute Antigravity executable and finds its installer folder', () => {
  const agy = path.join(root, 'tools', 'agy');
  fs.mkdirSync(path.dirname(agy), { recursive: true });
  fs.writeFileSync(agy, '#!/bin/sh\n', { mode: 0o755 });
  expect(() => saveEnvironment({ ANTIGRAVITY_COMMAND: 'agy' })).toThrow();
  saveEnvironment({ ANTIGRAVITY_COMMAND: agy });
  expect(environmentStatus().values.ANTIGRAVITY_COMMAND).toBe(agy);
  const env = serviceEnvironment('/runtime/node/bin/node', { NODE_ENV: 'test', HOME: root, PATH: '/usr/bin' });
  expect(env.ANTIGRAVITY_COMMAND).toBe(agy);
  // The Antigravity installer writes ~/.local/bin/agy, which a service started
  // outside a login shell would otherwise not have on PATH.
  expect(env.PATH?.split(':')).toContain(path.join(root, '.local/bin'));
});

it('preserves executable overrides for every known harness when rollout switches are off', async () => {
  vi.stubEnv('NEXT_PUBLIC_RI_CURSOR_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_RI_OPENCODE_ENABLED', 'false');
  vi.stubEnv('NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED', 'false');
  vi.resetModules();
  const { HARNESS_IDS, HARNESS_REGISTRY, KNOWN_HARNESS_IDS } = await import('@/lib/harness/registry');
  const environment = await import('./environment');
  expect(HARNESS_IDS).toEqual(['codex', 'claude']);
  const executable = path.join(root, 'tool');
  fs.writeFileSync(executable, '#!/bin/sh\n', { mode: 0o755 });
  const settings = Object.fromEntries(KNOWN_HARNESS_IDS.map((id) => [HARNESS_REGISTRY[id].commandEnv, executable]));
  environment.saveEnvironment(settings);
  expect(environment.environmentStatus().values).toEqual(settings);
  expect(environment.serviceEnvironment('/runtime/node/bin/node')).toMatchObject(settings);
  vi.resetModules();
});
