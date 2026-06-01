import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  readWorktreeServices,
  primaryService,
  injectSiblingEnv,
  SERVICES_CONFIG_FILENAME,
} from './services-config';

function writeConfig(dir: string, body: unknown) {
  fs.writeFileSync(path.join(dir, SERVICES_CONFIG_FILENAME), JSON.stringify(body));
}

describe('readWorktreeServices', () => {
  it('returns null when no config exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
    expect(readWorktreeServices(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('parses a valid multi-service config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
    writeConfig(dir, {
      services: [
        { name: 'web', command: 'pnpm dev:web', primary: true, env: { API_URL: '{api}' } },
        { name: 'api', command: 'pnpm dev:api' },
      ],
    });
    const services = readWorktreeServices(dir)!;
    expect(services).toHaveLength(2);
    expect(primaryService(services).name).toBe('web');
    expect(services[1]).toMatchObject({ name: 'api', command: 'pnpm dev:api' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips invalid entries (bad names, missing command) and dedupes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
    writeConfig(dir, {
      services: [
        { name: 'Web_Bad', command: 'x' },       // invalid label
        { name: 'api', command: '' },             // no command
        { name: 'ok', command: 'run' },
        { name: 'ok', command: 'dup' },           // duplicate
      ],
    });
    const services = readWorktreeServices(dir)!;
    expect(services.map((s) => s.name)).toEqual(['ok']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for malformed JSON or empty services', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
    fs.writeFileSync(path.join(dir, SERVICES_CONFIG_FILENAME), '{ not json');
    expect(readWorktreeServices(dir)).toBeNull();
    writeConfig(dir, { services: [] });
    expect(readWorktreeServices(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('defaults primary to the first service', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
    writeConfig(dir, { services: [{ name: 'a', command: 'x' }, { name: 'b', command: 'y' }] });
    expect(primaryService(readWorktreeServices(dir)!).name).toBe('a');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('injectSiblingEnv', () => {
  const urls = new Map([
    ['api', 'https://flow-a3f9-api.example'],
    ['web', 'https://flow-a3f9-web.example'],
  ]);

  it('substitutes {service} placeholders with sibling URLs', () => {
    expect(injectSiblingEnv({ API_URL: '{api}' }, urls)).toEqual({
      API_URL: 'https://flow-a3f9-api.example',
    });
  });

  it('handles multiple placeholders and surrounding text', () => {
    expect(injectSiblingEnv({ X: 'pre-{api}-{web}' }, urls)).toEqual({
      X: 'pre-https://flow-a3f9-api.example-https://flow-a3f9-web.example',
    });
  });

  it('leaves unknown placeholders untouched', () => {
    expect(injectSiblingEnv({ X: '{nope}' }, urls)).toEqual({ X: '{nope}' });
  });

  it('returns {} for undefined env', () => {
    expect(injectSiblingEnv(undefined, urls)).toEqual({});
  });
});
