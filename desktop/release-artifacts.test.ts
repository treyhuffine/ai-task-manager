import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import * as tar from 'tar';
import { afterEach, expect, it } from 'vitest';
import { appImageOffset, reviewedRuntime, verifyRuntimeArtifact, verifyShellArtifact } from './release-artifacts.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function releaseFixture(platform = 'darwin') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-release-artifact-test-')); roots.push(root);
  const resources = path.join(root, 'resources'); fs.mkdirSync(path.join(resources, 'node/bin'), { recursive: true }); fs.mkdirSync(path.join(resources, 'server/drizzle/meta'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'node/bin/node'), 'trusted node', { mode: 0o755 }); fs.writeFileSync(path.join(resources, 'server/drizzle/meta/_journal.json'), '{}'); fs.writeFileSync(path.join(resources, 'server/app'), 'reviewed application');
  function manifest() {
    const files: object[] = [];
    function walk(name: string) {
      const file = path.join(resources, name); const stat = fs.lstatSync(file);
      if (stat.isDirectory()) for (const child of fs.readdirSync(file).sort()) walk(`${name}/${child}`);
      else if (stat.isSymbolicLink()) files.push({ name, link: fs.readlinkSync(file), executable: false });
      else files.push({ name, sha256: hash(fs.readFileSync(file)), executable: !!(stat.mode & 0o111) });
    }
    walk('node'); walk('server');
    const content = { format: 1, version: '0.1.0', platform, arch: 'arm64', node: '26.5.0', files };
    fs.writeFileSync(path.join(resources, 'runtime-manifest.json'), JSON.stringify({ ...content, id: hash(JSON.stringify(content)) }));
  }
  manifest();
  async function archive(names = ['node', 'server', 'runtime-manifest.json']) { const file = path.join(root, `runtime-${fs.readdirSync(root).length}.tar.gz`); await tar.c({ file, cwd: resources, gzip: true }, names); return file; }
  return { root, resources, manifest, archive };
}

type ZipItem = { name: string; bytes: Buffer; mode?: number };
// Tiny stored ZIP fixture writer. Production reading uses pinned yauzl.
function zipFile(file: string, items: ZipItem[], zip64 = false) {
  const chunks: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name); const local = Buffer.alloc(30); const directory = Buffer.alloc(46); const crc = crc32(item.bytes);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(item.bytes.length, 18); local.writeUInt32LE(item.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(item.bytes.length, 20); directory.writeUInt32LE(item.bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    chunks.push(local, name, item.bytes); central.push(directory, name); offset += local.length + name.length + item.bytes.length;
  }
  const center = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16);
  const trailers: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(BigInt(44), 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14); record.writeBigUInt64LE(BigInt(items.length), 24); record.writeBigUInt64LE(BigInt(items.length), 32); record.writeBigUInt64LE(BigInt(center.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + center.length), 8); locator.writeUInt32LE(1, 16); trailers.push(record, locator); end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
  }
  fs.writeFileSync(file, Buffer.concat([...chunks, center, ...trailers, end])); return file;
}
function zipItems(reviewed: ReturnType<typeof reviewedRuntime>): ZipItem[] {
  return [...reviewed.expected.entries()].map(([name, item]: [string, {kind: string; executable?: boolean; link?: string}]) => ({ name: `Ri.app/Contents/Resources/${name}`, bytes: item.kind === 'SymbolicLink' ? Buffer.from(item.link!) : fs.readFileSync(path.join(reviewed.resources, name)), mode: item.kind === 'SymbolicLink' ? 0o120777 : item.executable ? 0o100755 : 0o100644 }));
}
function provenanceMetadata() {
  const bytes = Buffer.alloc(163); bytes.writeUInt32BE(0x00051607); bytes.writeUInt32BE(0x00020000, 4); bytes.write('Mac OS X        ', 8); bytes.writeUInt16BE(2, 24);
  bytes.writeUInt32BE(9, 26); bytes.writeUInt32BE(50, 30); bytes.writeUInt32BE(113, 34); bytes.writeUInt32BE(2, 38); bytes.writeUInt32BE(163, 42);
  bytes.writeUInt32BE(0x41545452, 84); bytes.writeUInt32BE(163, 92); bytes.writeUInt32BE(152, 96); bytes.writeUInt32BE(11, 100); bytes.writeUInt16BE(1, 118); bytes.writeUInt32BE(152, 120); bytes.writeUInt32BE(11, 124); bytes[130] = 21; bytes.write('com.apple.provenance\0', 131);
  return bytes;
}

it('streams and verifies an actual runtime tar against the reviewed manifest and bytes', async () => {
  const f = releaseFixture(); fs.symlinkSync('app', path.join(f.resources, 'server/link')); f.manifest(); const archive = await f.archive();
  const result = await verifyRuntimeArtifact(archive, reviewedRuntime(f.resources)); expect(result.sha256).toBe(hash(fs.readFileSync(archive))); expect(result.size).toBe(fs.statSync(archive).size);
});
it('rejects modified reviewed resources before archive inspection', () => {
  const f = releaseFixture(); fs.writeFileSync(path.join(f.resources, 'server/app'), 'changed'); expect(() => reviewedRuntime(f.resources)).toThrow('differ from their manifest');
});
it('rejects a different runtime and an unreviewed speech helper hidden in a no-speech archive', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources);
  fs.writeFileSync(path.join(f.resources, 'server/app'), 'changed application'); await expect(verifyRuntimeArtifact(await f.archive(), reviewed)).rejects.toThrow(/differs|differ/);
  fs.writeFileSync(path.join(f.resources, 'server/app'), 'reviewed application'); fs.mkdirSync(path.join(f.resources, 'server/speech-helper')); fs.writeFileSync(path.join(f.resources, 'server/speech-helper/ri-speech-helper'), 'unreviewed');
  await expect(verifyRuntimeArtifact(await f.archive(), reviewed)).rejects.toThrow('differs from reviewed');
});
it('rejects duplicate tar entries and escaping links without extracting', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources);
  await expect(verifyRuntimeArtifact(await f.archive(['node', 'server', 'server/app', 'runtime-manifest.json']), reviewed)).rejects.toThrow('Duplicate');
  fs.symlinkSync('../../outside', path.join(f.resources, 'server/escape'));
  await expect(verifyRuntimeArtifact(await f.archive(), reviewed)).rejects.toThrow('escapes'); expect(fs.existsSync(path.join(f.root, 'outside'))).toBe(false);
});
it('verifies the runtime embedded in an actual desktop ZIP, including symlinks', async () => {
  const f = releaseFixture(); fs.symlinkSync('app', path.join(f.resources, 'server/link')); f.manifest(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), zipItems(reviewed));
  const result = await verifyShellArtifact(zip, reviewed); expect(result.sha512).toBe(createHash('sha512').update(fs.readFileSync(zip)).digest('base64'));
});
it('accepts proper ZIP64 directory records and rejects wrapped/truncated classic entry counts', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = path.join(f.root, 'Ri.zip');
  await expect(verifyShellArtifact(zipFile(zip, zipItems(reviewed), true), reviewed)).resolves.toMatchObject({ size: fs.statSync(zip).size });
  zipFile(zip, zipItems(reviewed)); const bytes = fs.readFileSync(zip); bytes.writeUInt16LE(1, bytes.length - 14); bytes.writeUInt16LE(1, bytes.length - 12); fs.writeFileSync(zip, bytes);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('entry count does not cover');
});
it('follows adjacent ZIP64 locators with non-sentinel classic fields and requires matching views', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), zipItems(reviewed), true); const bytes = fs.readFileSync(zip);
  const end = bytes.length - 22; const record = end - 76;
  bytes.writeUInt16LE(Number(bytes.readBigUInt64LE(record + 32)), end + 8); bytes.writeUInt16LE(Number(bytes.readBigUInt64LE(record + 32)), end + 10);
  bytes.writeUInt32LE(Number(bytes.readBigUInt64LE(record + 40)), end + 12); bytes.writeUInt32LE(Number(bytes.readBigUInt64LE(record + 48)), end + 16); fs.writeFileSync(zip, bytes);
  await expect(verifyShellArtifact(zip, reviewed)).resolves.toMatchObject({ size: bytes.length });
  for (const field of ['count', 'length', 'offset']) {
    const changed = Buffer.from(bytes);
    if (field === 'count') { changed.writeUInt16LE(1, end + 8); changed.writeUInt16LE(1, end + 10); }
    else { const position = end + (field === 'length' ? 12 : 16); changed.writeUInt32LE(changed.readUInt32LE(position) + 1, position); }
    fs.writeFileSync(zip, changed); await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('Conflicting classic and ZIP64');
  }
});
it('rejects a locator hidden in a classic central-entry comment that makes the decoder skip an unreviewed file', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const items = [...zipItems(reviewed), { name: 'Ri.app/Contents/Resources/server/hidden', bytes: Buffer.from('unreviewed') }]; const zip = zipFile(path.join(f.root, 'Ri.zip'), items); const bytes = fs.readFileSync(zip);
  const endOffset = bytes.length - 22; const end = Buffer.from(bytes.subarray(endOffset)); const centralOffset = end.readUInt32LE(16); const centralLength = end.readUInt32LE(12);
  let last = centralOffset;
  for (let i = 1; i < items.length; i++) last += 46 + bytes.readUInt16LE(last + 28) + bytes.readUInt16LE(last + 30) + bytes.readUInt16LE(last + 32);
  // The classic view counts the hidden last member plus its 76-byte comment.
  // yauzl follows that comment's locator and would stop before the last member.
  bytes.writeUInt16LE(76, last + 32); end.writeUInt32LE(centralLength + 76, 12);
  const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(BigInt(44), 4); record.writeBigUInt64LE(BigInt(items.length - 1), 24); record.writeBigUInt64LE(BigInt(items.length - 1), 32); record.writeBigUInt64LE(BigInt(centralLength), 40); record.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(endOffset), 8); locator.writeUInt32LE(1, 16);
  fs.writeFileSync(zip, Buffer.concat([bytes.subarray(0, endOffset), record, locator, end]));
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('Conflicting classic and ZIP64');
});
it('requires a ZIP64 locator for sentinels and rejects the same malformed last end record as its decoder', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), zipItems(reviewed)); const bytes = fs.readFileSync(zip); const end = bytes.length - 22;
  const sentinel = Buffer.from(bytes); sentinel.writeUInt16LE(0xffff, end + 8); sentinel.writeUInt16LE(0xffff, end + 10); fs.writeFileSync(zip, sentinel);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('Missing or invalid ZIP64');
  bytes.writeUInt16LE(22, end + 20); const comment = Buffer.alloc(22); comment.writeUInt32LE(0x06054b50); comment.writeUInt16LE(1, 20); fs.writeFileSync(zip, Buffer.concat([bytes, comment]));
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('Invalid ZIP end directory comment length');
});
it('refuses shell-only helper substitution, extra speech files, and missing reviewed files', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const items = zipItems(reviewed); const zip = path.join(f.root, 'Ri.zip');
  items.find(item => item.name.endsWith('/server/app'))!.bytes = Buffer.from('different application'); await expect(verifyShellArtifact(zipFile(zip, items), reviewed)).rejects.toThrow(/differs|differ/);
  const extra = [...zipItems(reviewed), { name: 'Ri.app/Contents/Resources/server/speech-helper/ri-speech-helper', bytes: Buffer.from('hidden') }]; await expect(verifyShellArtifact(zipFile(zip, extra), reviewed)).rejects.toThrow('differs from reviewed');
  await expect(verifyShellArtifact(zipFile(zip, zipItems(reviewed).slice(1)), reviewed)).rejects.toThrow('missing reviewed');
});
it('rejects ZIP traversal, duplicate paths and symlink parent overlays', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = path.join(f.root, 'Ri.zip');
  for (const extra of [
    [{ name: '../escape', bytes: Buffer.from('x') }],
    [zipItems(reviewed)[0]],
    [{ name: 'Ri.app/Contents/Resources/server', bytes: Buffer.from('elsewhere'), mode: 0o120777 }],
  ]) await expect(verifyShellArtifact(zipFile(zip, [...zipItems(reviewed), ...extra]), reviewed)).rejects.toThrow();
});
it('rejects ZIP inflated declared sizes before streaming payload', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), zipItems(reviewed)); const bytes = fs.readFileSync(zip); const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt32LE(0xffffffff, central + 24); fs.writeFileSync(zip, bytes);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow(/size|Size/);
});
it('checks ZIP CRC even for shell bytes outside the embedded runtime', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), [...zipItems(reviewed), { name: 'Ri.app/Contents/Resources/app.asar', bytes: Buffer.from('shell-payload') }]);
  const bytes = fs.readFileSync(zip); bytes[bytes.indexOf(Buffer.from('shell-payload'))] ^= 1; fs.writeFileSync(zip, bytes);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('CRC mismatch');
});
it('accepts bounded ditto provenance sidecars for actual app members', async () => {
  const f = releaseFixture(); fs.symlinkSync('app', path.join(f.resources, 'server/link')); f.manifest(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), [...zipItems(reviewed), { name: '__MACOSX/Ri.app/Contents/Resources/server/._app', bytes: provenanceMetadata() }, { name: '__MACOSX/Ri.app/Contents/Resources/server/._link', bytes: provenanceMetadata() }]);
  await expect(verifyShellArtifact(zip, reviewed)).resolves.toMatchObject({ size: fs.statSync(zip).size });
});
it('rejects AppleDouble data/resource forks and unknown code-impact attributes', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = path.join(f.root, 'Ri.zip');
  for (const change of [(bytes: Buffer) => bytes.writeUInt32BE(1, 26), (bytes: Buffer) => bytes.writeUInt32BE(1, 46), (bytes: Buffer) => bytes.write('com.apple.quarantine\0', 131)]) {
    const bytes = provenanceMetadata(); change(bytes);
    await expect(verifyShellArtifact(zipFile(zip, [...zipItems(reviewed), { name: '__MACOSX/Ri.app/Contents/Resources/server/._app', bytes }]), reviewed)).rejects.toThrow('AppleDouble metadata');
  }
});
it('refuses AppleDouble links, missing targets and leading-dot validation bypasses', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = path.join(f.root, 'Ri.zip');
  for (const item of [
    { name: '__MACOSX/Ri.app/Contents/Resources/server/._app', bytes: Buffer.from('app'), mode: 0o120777 },
    { name: '__MACOSX/Ri.app/Contents/Resources/server/._missing', bytes: provenanceMetadata() },
    { name: './__MACOSX/Ri.app/Contents/Resources/server/._app', bytes: Buffer.from('unreviewed fork bytes') },
  ]) await expect(verifyShellArtifact(zipFile(zip, [...zipItems(reviewed), item]), reviewed)).rejects.toThrow(/AppleDouble|Noncanonical/);
});
it('bounds self-descendant symbolic-link expansion in a separate signer process', () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), [...zipItems(reviewed), { name: 'Ri.app/cycle', bytes: Buffer.from('cycle/child'), mode: 0o120777 }]);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import { reviewedRuntime, verifyShellArtifact } from "./desktop/release-artifacts.mjs"; await verifyShellArtifact(process.argv[1], reviewedRuntime(process.argv[2]));', zip, f.resources], { encoding: 'utf8', timeout: 5000 });
  expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0); expect(result.stderr).toContain('Cyclic or excessive release archive link');
});
it('rejects symlink-ancestor traversal using actual component resolution', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), [...zipItems(reviewed),
    { name: 'Ri.app/dir/', bytes: Buffer.alloc(0), mode: 0o040755 },
    { name: 'Ri.app/dir/up', bytes: Buffer.from('..'), mode: 0o120777 },
    { name: 'Ri.app/escape', bytes: Buffer.from('dir/up/../../external'), mode: 0o120777 },
    { name: 'Ri.app/external', bytes: Buffer.from('lexical decoy') },
  ]);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow(/escapes|traversal/);
});
it('rejects macOS case aliases that would overwrite the reviewed runtime', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), [...zipItems(reviewed), { name: 'Ri.app/Contents/Resources/SERVER/app', bytes: Buffer.from('hidden replacement') }]);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('collision');
});
it('rejects conflicting ZIP local filenames even when central names are reviewed', async () => {
  const f = releaseFixture(); const reviewed = reviewedRuntime(f.resources); const zip = zipFile(path.join(f.root, 'Ri.zip'), zipItems(reviewed)); const bytes = fs.readFileSync(zip); bytes[30] = 0x78; fs.writeFileSync(zip, bytes);
  await expect(verifyShellArtifact(zip, reviewed)).rejects.toThrow('Conflicting local');
});
it('rejects a captured helper carrying another build inventory before archive scans', () => {
  const f = releaseFixture(); const helper = path.join(f.resources, 'server/speech-helper'); fs.mkdirSync(helper); fs.writeFileSync(path.join(helper, 'ri-speech-helper'), 'build A'); fs.writeFileSync(path.join(helper, 'native-inventory.json'), JSON.stringify({ format: 1, files: { 'ri-speech-helper': { sha256: hash('build B'), size: 7 } } })); f.manifest();
  expect(() => reviewedRuntime(f.resources)).toThrow('Captured helper files');
});
it('reads the AppImage ELF boundary without invoking its executable', () => {
  const f = releaseFixture('linux'); const file = path.join(f.root, 'Ri.AppImage'); const bytes = Buffer.alloc(132); bytes.write('\x7fELF'); bytes[4] = 2; bytes[5] = 1; bytes.write('AI\x02', 8); bytes.writeBigUInt64LE(BigInt(64), 40); bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(1, 60); bytes.write('hsqs', 128); fs.writeFileSync(file, bytes);
  expect(appImageOffset(file)).toBe(128); bytes.writeBigUInt64LE(BigInt(999999), 40); fs.writeFileSync(file, bytes); expect(() => appImageOffset(file)).toThrow('ELF bounds');
});
it('requires a trusted SquashFS reader rather than executing an AppImage', async () => {
  const f = releaseFixture('linux'); const file = path.join(f.root, 'Ri.AppImage'); const bytes = Buffer.alloc(132); bytes.write('\x7fELF'); bytes[4] = 2; bytes[5] = 1; bytes.write('AI\x02', 8); bytes.writeBigUInt64LE(BigInt(64), 40); bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(1, 60); bytes.write('hsqs', 128); fs.writeFileSync(file, bytes);
  const prior = process.env.PATH; process.env.PATH = f.root;
  try { await expect(verifyShellArtifact(file, reviewedRuntime(f.resources))).rejects.toThrow('sqfs2tar'); } finally { process.env.PATH = prior; }
});
it('checks the full AppImage reader boundary with bounded converted tar bytes and no candidate execution', async () => {
  const f = releaseFixture('linux'); const reviewed = reviewedRuntime(f.resources); const converted = path.join(f.root, 'converted.tar');
  await tar.c({ file: converted, cwd: f.root }, ['resources']);
  const file = path.join(f.root, 'Ri.AppImage'); const bytes = Buffer.alloc(132); bytes.write('\x7fELF'); bytes[4] = 2; bytes[5] = 1; bytes.write('AI\x02', 8); bytes.writeBigUInt64LE(BigInt(64), 40); bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(1, 60); bytes.write('hsqs', 128); fs.writeFileSync(file, bytes, { mode: 0o600 });
  // Only the external format decoder is replaced by a trusted fixture tool.
  // It models sqfs2tar's standard root-relative output, not a native Linux run.
  const reader = path.join(f.root, 'sqfs2tar'); fs.writeFileSync(reader, `#!${process.execPath}\nconst fs=require('node:fs');if(JSON.stringify(process.argv.slice(2,5))!==JSON.stringify(['--no-skip','--no-xattr','--no-hard-links']))process.exit(2);if(fs.readFileSync(process.argv[5]).toString()!=='hsqs')process.exit(3);process.stdout.write(fs.readFileSync(${JSON.stringify(converted)}));\n`, { mode: 0o755 });
  const prior = process.env.PATH; process.env.PATH = f.root;
  try {
    await expect(verifyShellArtifact(file, reviewed)).resolves.toMatchObject({ size: bytes.length });
    fs.writeFileSync(path.join(f.resources, 'server/app'), 'unreviewed app'); await tar.c({ file: converted, cwd: f.root }, ['resources']);
    await expect(verifyShellArtifact(file, reviewed)).rejects.toThrow(/differs|differ/);
  } finally { process.env.PATH = prior; }
});
