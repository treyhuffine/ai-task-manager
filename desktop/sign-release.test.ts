import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import * as tar from 'tar';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture(speech: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-release-sign-test-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'server/drizzle/meta'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node/bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node/bin/node'), 'fixture node', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'server/drizzle/meta/_journal.json'), '{}');
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  if (speech) {
    fs.mkdirSync(path.join(root, 'server/speech-helper')); fs.writeFileSync(path.join(root, 'server/speech-helper/ri-speech-helper'), 'fixture helper');
    fs.writeFileSync(path.join(root, 'server/speech-helper/native-inventory.json'), JSON.stringify({ format: 1, files: { 'ri-speech-helper': { sha256: hash('fixture helper'), size: Buffer.byteLength('fixture helper') } } }));
  }
  const names = ['node/bin/node', 'server/drizzle/meta/_journal.json', ...(speech ? ['server/speech-helper/native-inventory.json', 'server/speech-helper/ri-speech-helper'] : [])];
  const content = { format: 1, version: '0.1.0', platform: 'darwin', arch: 'arm64', node: '26.5.0', files: names.map(name => ({ name, sha256: hash(fs.readFileSync(path.join(root, name))), executable: name === 'node/bin/node' })) };
  fs.writeFileSync(path.join(root, 'runtime-manifest.json'), JSON.stringify({ ...content, id: hash(JSON.stringify(content)) }));
  await tar.c({ file: path.join(root, 'runtime.tar.gz'), cwd: root, gzip: true }, ['node', 'server', 'runtime-manifest.json']);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(root, 'key.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const output = path.join(root, 'release.json');
  const run = () => spawnSync(process.execPath, [path.resolve('desktop/sign-release.mjs'), '--resources', root,
    '--runtime', path.join(root, 'runtime.tar.gz'), '--runtime-url', 'https://example.test/runtime.tar.gz',
    '--sequence', '1', '--private-key', path.join(root, 'key.pem'), '--out', output], {
    encoding: 'utf8', env: { ...process.env, RI_SPEECH_DISTRIBUTION_APPROVED: 'true' },
  });
  return { run, output, publicKey, root };
}
it('refuses to sign speech-bearing releases without artifact-bound source and publisher review, even with the former Boolean flag', async () => {
  const f = await fixture(true); const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('artifact-bound publisher review');
  expect(fs.existsSync(f.output)).toBe(false);
});
it('retains ordinary release signing when speech is not bundled', async () => {
  const f = await fixture(false); const result = f.run(); expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  const envelope = JSON.parse(fs.readFileSync(f.output, 'utf8'));
  expect(verify(null, Buffer.from(envelope.payload, 'base64'), f.publicKey, Buffer.from(envelope.signature, 'base64'))).toBe(true);
});
it('cannot sign an unreviewed speech-bearing archive using a no-speech resources directory', async () => {
  const reviewed = await fixture(false); const other = await fixture(true);
  fs.copyFileSync(path.join(other.root, 'runtime.tar.gz'), path.join(reviewed.root, 'runtime.tar.gz'));
  const result = reviewed.run(); expect(result.status).not.toBe(0); expect(result.stderr).toMatch(/differs|differ|exceeds/); expect(fs.existsSync(reviewed.output)).toBe(false);
});
