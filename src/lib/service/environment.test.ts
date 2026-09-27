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
