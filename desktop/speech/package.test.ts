import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageSpeechHelper } from './package.mjs';
import { createHash } from 'node:crypto';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: spawn }));
const roots: string[] = [];
beforeEach(() => { spawn.mockReset().mockReturnValue({ status: 0, stdout: '{"protocol":1}' }); });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function helper(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-speech-package-'));
  roots.push(root);
  const source = path.join(root, 'helper');
  const target = path.join(root, 'runtime/server/speech-helper');
  fs.mkdirSync(path.join(source, '_internal'), { recursive: true });
  fs.writeFileSync(path.join(source, 'build.json'), JSON.stringify({ protocol: 1, platform: process.platform, arch: process.arch, ...overrides }));
  for (const name of ['ri-speech-helper', 'NOTICES.md', 'requirements.txt']) fs.writeFileSync(path.join(source, name), name);
  fs.writeFileSync(path.join(source, '_internal/onnxruntime.fixture'), 'native-library-bytes');
  const scripts = path.resolve('desktop/speech');
  fs.cpSync(path.join(scripts, 'licenses'), path.join(source, 'licenses/native'), { recursive: true });
  fs.copyFileSync(path.join(scripts, 'source-catalog.json'), path.join(source, 'source-catalog.json'));
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const files: Record<string, { size: number; sha256: string }> = {};
  function inventory(directory: string) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) inventory(file);
      else files[path.relative(source, file).split(path.sep).join('/')] = { size: fs.statSync(file).size, sha256: hash(file) };
    }
  }
  inventory(source);
  fs.writeFileSync(path.join(source, 'native-inventory.json'), JSON.stringify({ format: 1, native: [{ file: '_internal/onnxruntime.fixture' }], problems: [], files, sourceCatalogSha256: hash(path.join(scripts, 'source-catalog.json')) }));
  return { source, target };
}

describe('optional native speech package', () => {
  it('copies a verified native helper with its libraries and notices before runtime signing', () => {
    const { source, target } = helper();
    stageSpeechHelper(source, target);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(path.join(source, 'ri-speech-helper'), ['--version'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4096 });
    expect(fs.readFileSync(path.join(target, '_internal/onnxruntime.fixture'), 'utf8')).toBe('native-library-bytes');
    expect(fs.existsSync(path.join(target, 'NOTICES.md'))).toBe(true);
  });

  it.each([{ platform: 'unsupported' }, { arch: 'unsupported' }, { protocol: 2 }])('rejects incompatible metadata before executing helper: %j', (overrides) => {
    const { source, target } = helper(overrides);
    expect(() => stageSpeechHelper(source, target)).toThrow('OS and architecture');
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  it('does not stage a helper when the native probe fails', () => {
    const { source, target } = helper();
    spawn.mockReturnValue({ status: 1, stderr: 'missing native dependency' });
    expect(() => stageSpeechHelper(source, target)).toThrow('native probe failed');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('requires a helper build rather than silently making a speech-less package', () => {
    const { source, target } = helper();
    fs.unlinkSync(path.join(source, 'build.json'));
    expect(() => stageSpeechHelper(source, target)).toThrow('pnpm speech:build');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses an altered helper or removed native notice before invoking it', () => {
    const { source, target } = helper();
    fs.appendFileSync(path.join(source, '_internal/onnxruntime.fixture'), 'altered');
    expect(() => stageSpeechHelper(source, target)).toThrow('changed after native inspection');
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  it('uses kernel link resolution when a symlink ancestor precedes parent traversal', () => {
    const { source, target } = helper();
    fs.mkdirSync(path.join(source, 'dir'));
    fs.symlinkSync('..', path.join(source, 'dir/up'));
    fs.writeFileSync(path.join(source, 'dir/external'), 'lexical decoy');
    fs.writeFileSync(path.join(path.dirname(source), 'external'), 'outside helper');
    fs.symlinkSync('dir/up/../external', path.join(source, 'escape'));
    expect(fs.readFileSync(path.join(source, 'escape'), 'utf8')).toBe('outside helper');
    expect(() => stageSpeechHelper(source, target)).toThrow('escapes its installation');
    expect(spawn).not.toHaveBeenCalled();
  });
});
