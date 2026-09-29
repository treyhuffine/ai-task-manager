/** Publisher-side correspondence checks. Never execute or extract a candidate.
 * Archive constraints mirror src/lib/service/release.ts, with byte comparison
 * against the reviewed runtime added before its release envelope is signed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const GiB = 1024 ** 3;
const MAX_ARCHIVE = 8 * GiB;
const MAX_ENTRIES = 200_000;
const MAX_SHELL_ENTRIES = 300_000;
const DEADLINE = 10 * 60_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function safeName(name) {
  const value = name.replace(/\/$/, '');
  if (!value || value.length > 4096 || /[\\\x00-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe release archive path: ${name}`);
  return value;
}
function safeLink(name, link) {
  if (!link || link.length > 4096 || /[\\\x00-\x1f\x7f]/.test(link) || path.posix.isAbsolute(link)) throw new Error('Unsafe release archive symbolic link');
  // Match the installed-runtime acceptance policy. Parent segments may lead a
  // relative link, but cannot follow a named component/symlink ancestor.
  let named = false;
  for (const part of link.split('/')) {
    if (part === '..' && named) throw new Error('Unsafe parent traversal after a named symbolic-link component');
    if (part && part !== '.' && part !== '..') named = true;
  }
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), link));
  if (target === '..' || target.startsWith('../')) throw new Error('Release archive link escapes its root');
  return target;
}
function hashFile(file) {
  const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); const fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function plainFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARCHIVE) throw new Error('Release artifact must be a bounded regular file');
  return stat;
}
const sameFile = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);

/** Narrow ditto AppleDouble profile: empty resource fork, zero FinderInfo,
 * and provenance only. Never accept data forks, ACLs, compression/code-impact
 * xattrs or arbitrary resource files outside the inspected application.
 * Layout: apple-oss-distributions/copyfile, apple_double_header/attr_header. */
function verifyAppleDouble(bytes) {
  const fail = () => { throw new Error('Unsupported or unsafe AppleDouble metadata. Rebuild the ZIP without unreviewed resource forks or extended attributes.'); };
  if (bytes.length < 84 || bytes.length > 65536 || bytes.readUInt32BE(0) !== 0x00051607 || bytes.readUInt32BE(4) !== 0x00020000 || bytes.readUInt16BE(24) !== 2) fail();
  if (bytes.readUInt32BE(26) !== 9 || bytes.readUInt32BE(30) !== 50 || bytes.readUInt32BE(34) !== bytes.length - 50 || bytes.readUInt32BE(38) !== 2 || bytes.readUInt32BE(42) !== bytes.length || bytes.readUInt32BE(46) !== 0) fail();
  if (bytes.subarray(50, 84).some(byte => byte !== 0)) fail();
  if (bytes.length === 84) return;
  if (bytes.length < 120 || bytes.readUInt32BE(84) !== 0x41545452 || bytes.readUInt32BE(92) !== bytes.length || bytes.subarray(104, 118).some(byte => byte !== 0)) fail();
  const dataStart = bytes.readUInt32BE(96); const dataLength = bytes.readUInt32BE(100); const count = bytes.readUInt16BE(118);
  if (dataStart < 120 || dataStart > bytes.length || dataStart + dataLength !== bytes.length || count > 1) fail();
  if (count === 0) { if (dataStart !== 120 || dataLength) fail(); return; }
  if (dataStart < 132) fail();
  const nameLength = bytes[130]; const end = 131 + nameLength;
  if (!nameLength || end > dataStart || !bytes.subarray(131, end).equals(Buffer.from('com.apple.provenance\0')) || bytes.readUInt16BE(128) !== 0 || bytes.readUInt32BE(120) !== dataStart || bytes.readUInt32BE(124) !== dataLength || dataLength > 1024 || ((end + 3) & ~3) !== dataStart || bytes.subarray(end, dataStart).some(byte => byte !== 0)) fail();
}

export function reviewedRuntime(resources) {
  resources = fs.realpathSync.native(resources);
  const manifestFile = path.join(resources, 'runtime-manifest.json');
  if (plainFile(manifestFile).size > 32 * 1024 ** 2) throw new Error('Runtime manifest is too large');
  const bytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(bytes);
  const { id, ...content } = manifest;
  if (manifest.format !== 1 || !/^[a-f0-9]{64}$/.test(id) || sha(JSON.stringify(content)) !== id || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_ENTRIES || !['darwin', 'linux'].includes(manifest.platform) || !['arm64', 'x64'].includes(manifest.arch)) throw new Error('Invalid reviewed runtime manifest');
  const expected = new Map(); const actual = []; const directories = new Set(); let total = 0;
  function walk(name) {
    safeName(name);
    if (name === 'server/.next-desktop/cache') return;
    const file = path.join(resources, name); const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      directories.add(name);
      if (directories.size > MAX_ENTRIES) throw new Error('Reviewed runtime has too many directories');
      for (const child of fs.readdirSync(file).sort()) walk(`${name}/${child}`);
    } else if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(file); safeLink(name, link);
      const target = path.relative(resources, fs.realpathSync.native(file));
      if (target === '..' || target.startsWith(`..${path.sep}`) || path.isAbsolute(target)) throw new Error('Reviewed runtime link escapes its root');
      actual.push({ name, link, executable: false }); expected.set(name, { kind: 'SymbolicLink', link, size: 0 });
    } else if (stat.isFile()) {
      if (stat.size > MAX_ARCHIVE - total) throw new Error('Reviewed runtime exceeds inspection limits');
      const sha256 = hashFile(file); const executable = !!(stat.mode & 0o111);
      actual.push({ name, sha256, executable }); expected.set(name, { kind: 'File', sha256, executable, size: stat.size }); total += stat.size;
    } else throw new Error('Unsupported reviewed runtime entry');
    if (actual.length > MAX_ENTRIES || total > MAX_ARCHIVE) throw new Error('Reviewed runtime exceeds inspection limits');
  }
  walk('node'); walk('server');
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Reviewed runtime files differ from their manifest');
  const helperPrefix = 'server/speech-helper/';
  if ([...expected.keys()].some(name => name.startsWith(helperPrefix))) {
    const inventoryName = `${helperPrefix}native-inventory.json`;
    const recorded = expected.get(inventoryName);
    if (!recorded || recorded.kind !== 'File' || recorded.size > 32 * 1024 ** 2) throw new Error('Reviewed helper is missing its native inventory');
    const bytes = fs.readFileSync(path.join(resources, inventoryName));
    if (sha(bytes) !== recorded.sha256) throw new Error('Helper inventory changed during inspection');
    const inventory = JSON.parse(bytes); const helperFiles = {};
    for (const [name, entry] of expected) if (name.startsWith(helperPrefix) && name !== inventoryName) helperFiles[name.slice(helperPrefix.length)] = entry.kind === 'SymbolicLink' ? { link: entry.link } : { sha256: entry.sha256, size: entry.size };
    if (inventory.format !== 1 || !isDeepStrictEqual(helperFiles, inventory.files)) throw new Error('Captured helper files do not match their native inventory');
  }
  expected.set('runtime-manifest.json', { kind: 'File', sha256: sha(bytes), size: bytes.length, executable: false }); total += bytes.length;
  const policy = path.join(resources, 'release-policy.json');
  if (fs.existsSync(policy)) {
    const stat = plainFile(policy); expected.set('release-policy.json', { kind: 'File', sha256: hashFile(policy), size: stat.size, executable: !!(stat.mode & 0o111) }); total += stat.size;
  }
  return { resources, manifest, expected, total, directories };
}

function checker(reviewed, shell = false) {
  const prefix = !shell ? '' : reviewed.manifest.platform === 'darwin' ? 'Ri.app/Contents/Resources/' : 'resources/';
  const found = new Set(); const entries = new Map(); const directories = new Set(); const macNames = new Map(); let size = 0;
  const runtimeDirs = new Set(reviewed.directories);
  for (const name of reviewed.expected.keys()) { let dir = path.posix.dirname(name); while (dir !== '.') { runtimeDirs.add(dir); dir = path.posix.dirname(dir); } }
  return {
    add(rawName, kind, length, mode, link) {
      // sqfs2tar may preserve an explicit filesystem-root directory. Accept
      // that conventional prefix only once, never embedded dot segments.
      const normalized = rawName.startsWith('./') ? rawName.slice(2) : rawName;
      if (shell && kind === 'Directory' && (rawName === '.' || rawName === './')) {
        if (length || entries.has('.')) throw new Error('Duplicate or invalid archive root');
        entries.set('.', { kind }); return null;
      }
      const name = safeName(normalized);
      if (reviewed.manifest.platform === 'darwin') {
        const parts = name.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join('/'); const folded = prefix.normalize('NFD').toLowerCase();
          if (macNames.has(folded) && macNames.get(folded) !== prefix) throw new Error('Case or Unicode collision in macOS release archive');
          macNames.set(folded, prefix);
        }
      }
      if (entries.size >= (shell ? MAX_SHELL_ENTRIES : MAX_ENTRIES) || entries.has(name)) throw new Error('Duplicate or excessive release archive entries');
      if (!['File', 'Directory', 'SymbolicLink'].includes(kind)) throw new Error('Unsupported release archive entry');
      if (!Number.isSafeInteger(length) || length < 0 || (kind !== 'File' && length)) throw new Error('Invalid release archive size');
      size += length;
      if (size > reviewed.total + (shell ? 2 * GiB : 0)) throw new Error('Release archive exceeds reviewed unpacked size');
      const metadata = shell && reviewed.manifest.platform === 'darwin' && (name === '__MACOSX' || name.startsWith('__MACOSX/'));
      if (shell && reviewed.manifest.platform === 'darwin' && name !== 'Ri.app' && !name.startsWith('Ri.app/') && !metadata) throw new Error('Unexpected application in desktop ZIP');
      if (metadata) {
        if (kind === 'Directory') {
          if (name !== '__MACOSX' && name !== '__MACOSX/Ri.app' && !name.startsWith('__MACOSX/Ri.app/')) throw new Error('Unexpected AppleDouble directory');
        } else {
          if (kind !== 'File' || length > 65536 || !path.posix.basename(name).startsWith('._')) throw new Error('Unsafe AppleDouble sidecar');
          safeName(path.posix.basename(name).slice(2));
        }
      }
      entries.set(name, { kind, link });
      let parent = path.posix.dirname(name); while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
      if (kind === 'Directory') directories.add(name);
      if (kind === 'SymbolicLink') safeLink(name, link);
      const relative = name.startsWith(prefix) ? name.slice(prefix.length) : null;
      const isRuntime = relative !== null && /^(node|server|runtime-manifest\.json|release-policy\.json)(\/|$)/.test(relative);
      if (!shell || isRuntime) {
        if (kind === 'Directory' && runtimeDirs.has(relative)) return null;
        const expected = reviewed.expected.get(relative);
        if (!expected || expected.kind !== kind || (kind === 'File' && (expected.size !== length || expected.executable !== !!(mode & 0o111))) || (kind === 'SymbolicLink' && expected.link !== link)) throw new Error(`Artifact differs from reviewed runtime: ${name}`);
        found.add(relative);
        return expected.kind === 'File' ? expected.sha256 : null;
      }
      return null;
    },
    finish() {
      for (const name of reviewed.expected.keys()) if (!found.has(name)) throw new Error(`Artifact is missing reviewed runtime entry: ${name}`);
      for (const [name, entry] of entries) {
        if (name.startsWith('__MACOSX/') && entry.kind === 'Directory' && !directories.has(name.slice('__MACOSX/'.length))) throw new Error('AppleDouble directory has no corresponding application directory');
        if (name.startsWith('__MACOSX/') && entry.kind === 'File') {
          const target = path.posix.join(path.posix.dirname(name).slice('__MACOSX/'.length), path.posix.basename(name).slice(2));
          // ditto also preserves provenance on pnpm's symbolic links. Those
          // links are still resolved and containment-checked below. The
          // sidecar itself is always a regular, provenance-only metadata file.
          if ((target !== 'Ri.app' && !target.startsWith('Ri.app/')) || !entries.has(target)) throw new Error('AppleDouble sidecar has no corresponding application member');
        }
        let parent = path.posix.dirname(name);
        while (parent !== '.') { if (entries.has(parent) && entries.get(parent).kind !== 'Directory') throw new Error('Archive entry descends through a file or symbolic link'); parent = path.posix.dirname(parent); }
        if (entry.kind === 'SymbolicLink') {
          // Kernel semantics: expand each link before applying subsequent '..'.
          // Lexical normalize/JS realpath can erase a symlink ancestor and hide
          // a path that the actual filesystem resolves outside the archive.
          const pending = [...path.posix.dirname(name).split('/'), ...entry.link.split('/')]; const resolved = []; let hops = 0;
          while (pending.length) {
            if (pending.join('/').length + resolved.join('/').length > 4096) throw new Error('Excessive release archive link expansion');
            const part = pending.shift();
            if (!part || part === '.') continue;
            if (part === '..') { if (!resolved.length) throw new Error('Release archive link escapes its root'); resolved.pop(); continue; }
            resolved.push(part); const target = resolved.join('/'); const next = entries.get(target);
            if (next?.kind === 'SymbolicLink') {
              if (++hops > 40) throw new Error('Cyclic or excessive release archive link');
              safeLink(target, next.link); resolved.pop(); pending.unshift(...next.link.split('/'));
            } else if (!next && !directories.has(target)) throw new Error('Dangling release archive link');
            else if (pending.length && next && next.kind !== 'Directory') throw new Error('Archive link traverses a non-directory');
          }
        }
      }
    },
  };
}

async function inspectTar(stream, reviewed, shell = false) {
  const check = checker(reviewed, shell); let failure;
  const parser = new tar.Parser({ strict: true, onReadEntry(entry) {
    try {
      const expected = check.add(entry.path, entry.type, entry.size, entry.mode, entry.linkpath);
      const hash = createHash('sha256'); let length = 0;
      entry.on('data', chunk => { length += chunk.length; hash.update(chunk); });
      entry.on('end', () => { if (length !== entry.size || (expected && hash.digest('hex') !== expected)) { failure = new Error(`Artifact bytes differ from reviewed runtime: ${entry.path}`); parser.abort(failure); } });
    } catch (error) { failure = error; parser.abort(error); }
  } });
  await pipeline(stream, parser, { signal: AbortSignal.timeout(DEADLINE) });
  if (failure) throw failure;
  check.finish();
}

export async function verifyRuntimeArtifact(file, reviewed) {
  const before = plainFile(file); const hash = createHash('sha256');
  const hashing = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  const input = fs.createReadStream(file, { end: before.size - 1 }); input.on('error', error => hashing.destroy(error)); input.pipe(hashing);
  try { await inspectTar(hashing, reviewed); } finally { input.destroy(); }
  if (!sameFile(before, fs.lstatSync(file))) throw new Error('Runtime archive changed during inspection');
  return { sha256: hash.digest('hex'), size: before.size };
}

function verifyZipDirectory(file) {
  // Some native ditto versions wrap the classic 16-bit entry count for large
  // apps without writing ZIP64. Readers then inspect only a prefix. Require
  // the declared count to cover the complete central directory, never repair
  // or override the parser's count. Content decoding stays with yauzl.
  const size = plainFile(file).size; const fd = fs.openSync(file, 'r');
  function read(length, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > size) throw new Error('Invalid ZIP directory bounds');
    const bytes = Buffer.alloc(length); if (fs.readSync(fd, bytes, 0, length, offset) !== length) throw new Error('Truncated ZIP directory'); return bytes;
  }
  try {
    // Select the same last signature as yauzl, including its ZIP64-locator
    // lookbehind. A later malformed signature must not select another view.
    const start = Math.max(0, size - 65577); const tail = read(size - start, start); let index = tail.length - 22;
    for (; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50) break;
    if (index < 0) throw new Error('Missing ZIP end directory');
    const end = tail.subarray(index); const endOffset = start + index;
    if (22 + end.readUInt16LE(20) !== end.length) throw new Error('Invalid ZIP end directory comment length');
    if (end.readUInt16LE(4) || end.readUInt16LE(6) || end.readUInt16LE(8) !== end.readUInt16LE(10)) throw new Error('Multi-disk ZIPs are unsupported');
    let count = end.readUInt16LE(10); let length = end.readUInt32LE(12); let offset = end.readUInt32LE(16); let boundary = endOffset;
    // yauzl follows any adjacent locator, even when classic fields are not
    // sentinels. Inspect that same record and reject contradictory views.
    const locator = endOffset >= 20 ? read(20, endOffset - 20) : null;
    if (locator?.readUInt32LE(0) === 0x07064b50) {
      if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) throw new Error('Missing or invalid ZIP64 directory');
      const recordOffset = Number(locator.readBigUInt64LE(8)); const record = read(56, recordOffset); const recordLength = Number(record.readBigUInt64LE(4));
      if (record.readUInt32LE(0) !== 0x06064b50 || recordLength < 44 || recordLength > 65536 || recordOffset + 12 + recordLength !== endOffset - 20 || record.readUInt32LE(16) || record.readUInt32LE(20) || record.readBigUInt64LE(24) !== record.readBigUInt64LE(32)) throw new Error('Invalid ZIP64 end directory');
      const zip64Count = Number(record.readBigUInt64LE(32)); const zip64Length = Number(record.readBigUInt64LE(40)); const zip64Offset = Number(record.readBigUInt64LE(48));
      if ((count !== 0xffff && count !== zip64Count) || (length !== 0xffffffff && length !== zip64Length) || (offset !== 0xffffffff && offset !== zip64Offset)) throw new Error('Conflicting classic and ZIP64 directory views');
      count = zip64Count; length = zip64Length; offset = zip64Offset; boundary = recordOffset;
    } else if (count === 0xffff || length === 0xffffffff || offset === 0xffffffff) throw new Error('Missing or invalid ZIP64 directory');
    if (!Number.isSafeInteger(count) || count > MAX_SHELL_ENTRIES || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length !== boundary) throw new Error('Invalid or excessive ZIP directory');
    const limit = offset + length; let actual = 0;
    while (offset < limit) {
      if (++actual > MAX_SHELL_ENTRIES || offset + 46 > limit) throw new Error('Invalid or excessive ZIP directory');
      const header = read(46, offset);
      if (header.readUInt32LE(0) !== 0x02014b50) throw new Error('Invalid ZIP central header');
      offset += 46 + header.readUInt16LE(28) + header.readUInt16LE(30) + header.readUInt16LE(32);
    }
    if (offset !== limit || actual !== count) throw new Error('ZIP entry count does not cover its central directory. Build the updater ZIP with electron-builder and its ZIP64-capable archive producer.');
  } finally { fs.closeSync(fd); }
}

async function inspectZip(file, reviewed) {
  verifyZipDirectory(file);
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, result) => error ? reject(error) : resolve(result)));
  const check = checker(reviewed, true);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { zip.close(); reject(new Error('Desktop ZIP inspection timed out')); }, DEADLINE); timer.unref();
      const fail = error => { clearTimeout(timer); zip.close(); reject(error); };
      zip.on('error', fail); zip.on('end', () => { clearTimeout(timer); resolve(); });
      zip.on('entry', entry => { void (async () => {
        if (entry.fileName.startsWith('./')) throw new Error('Noncanonical desktop ZIP path');
        if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) throw new Error('Encrypted or unsupported desktop ZIP entry');
        const local = await zip.readLocalFileHeaderPromise(entry);
        if (!local.fileName.equals(entry.fileNameRaw) || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag || local.compressionMethod !== entry.compressionMethod) throw new Error('Conflicting local and central ZIP headers');
        const mode = entry.externalFileAttributes >>> 16; const type = mode & 0o170000;
        const kind = type === 0o120000 ? 'SymbolicLink' : entry.fileName.endsWith('/') ? 'Directory' : 'File';
        if (![0, 0o100000, 0o040000, 0o120000].includes(type) || (type === 0o040000 && kind !== 'Directory')) throw new Error('Unsupported desktop ZIP filesystem entry');
        if (entry.uncompressedSize > (kind === 'SymbolicLink' ? 4096 : reviewed.total + 2 * GiB)) throw new Error('Desktop ZIP entry exceeds inspection size limit');
        const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, result) => error ? rej(error) : res(result)));
        const metadata = entry.fileName.startsWith('__MACOSX/') && kind === 'File';
        const hash = createHash('sha256'); const chunks = []; let length = 0; let crc = 0;
        const expected = kind === 'SymbolicLink' ? null : check.add(entry.fileName, kind, entry.uncompressedSize, mode);
        for await (const chunk of stream) { length += chunk.length; if (length > entry.uncompressedSize) throw new Error('Desktop ZIP expanded beyond its declared size'); hash.update(chunk); crc = crc32(chunk, crc); if (kind === 'SymbolicLink' || metadata) chunks.push(chunk); }
        if (crc !== entry.crc32) throw new Error(`Desktop ZIP CRC mismatch: ${entry.fileName}`);
        if (length !== entry.uncompressedSize || (expected && hash.digest('hex') !== expected)) throw new Error(`Artifact bytes differ from reviewed runtime: ${entry.fileName}`);
        if (kind === 'SymbolicLink') check.add(entry.fileName, kind, 0, mode, Buffer.concat(chunks).toString('utf8'));
        if (metadata) verifyAppleDouble(Buffer.concat(chunks));
        zip.readEntry();
      })().catch(fail); });
      zip.readEntry();
    });
    check.finish();
  } finally { zip.close(); }
}

/** Match the upstream type-2 runtime's ELF extent calculation, without running
 * --appimage-offset. Supported release targets are 64-bit little-endian ELF.
 * https://github.com/AppImage/type2-runtime/blob/main/src/runtime/runtime.c */
export function appImageOffset(file) {
  const stat = plainFile(file); const fd = fs.openSync(file, 'r');
  function read(size, offset) { if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > stat.size) throw new Error('Invalid AppImage ELF bounds'); const bytes = Buffer.alloc(size); if (fs.readSync(fd, bytes, 0, size, offset) !== size) throw new Error('Truncated AppImage'); return bytes; }
  try {
    const h = read(64, 0);
    if (h.subarray(0, 4).toString('hex') !== '7f454c46' || h[4] !== 2 || h[5] !== 1 || h.subarray(8, 11).toString('hex') !== '414902') throw new Error('Expected a 64-bit type-2 AppImage');
    const start = Number(h.readBigUInt64LE(40)); const width = h.readUInt16LE(58); const count = h.readUInt16LE(60);
    if (width !== 64 || !count) throw new Error('Unsupported AppImage ELF section table');
    const last = read(64, start + width * (count - 1));
    const offset = Math.max(start + width * count, Number(last.readBigUInt64LE(24)) + Number(last.readBigUInt64LE(32)));
    if (read(4, offset).toString() !== 'hsqs') throw new Error('AppImage SquashFS payload does not match ELF extent');
    return offset;
  } finally { fs.closeSync(fd); }
}

async function inspectAppImage(file, reviewed) {
  const offset = appImageOffset(file); const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-release-inspection-'));
  try {
    const squashfs = path.join(temporary, 'payload.squashfs');
    await pipeline(fs.createReadStream(file, { start: offset, end: plainFile(file).size - 1 }), fs.createWriteStream(squashfs, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(DEADLINE) });
    const child = spawn('sqfs2tar', ['--no-skip', '--no-xattr', '--no-hard-links', squashfs], { stdio: ['ignore', 'pipe', 'pipe'], timeout: DEADLINE, killSignal: 'SIGKILL' });
    let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    const finished = new Promise((resolve, reject) => {
      child.on('error', error => reject(new Error(`AppImage inspection requires trusted sqfs2tar from squashfs-tools-ng on PATH: ${error.message}`)));
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`sqfs2tar inspection failed (${code}): ${stderr}`)));
    });
    try { await Promise.all([finished, inspectTar(child.stdout, reviewed, true)]); }
    finally { if (child.exitCode === null) child.kill('SIGKILL'); await finished.catch(() => {}); }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export async function verifyShellArtifact(file, reviewed) {
  const before = plainFile(file);
  if (reviewed.manifest.platform === 'darwin') {
    if (!file.toLowerCase().endsWith('.zip')) throw new Error('macOS release shell must be the updater ZIP');
    await inspectZip(file, reviewed);
  } else {
    if (!file.endsWith('.AppImage')) throw new Error('Linux release shell must be an AppImage');
    await inspectAppImage(file, reviewed);
  }
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(file, { end: before.size - 1 })) hash.update(chunk);
  if (!sameFile(before, fs.lstatSync(file))) throw new Error('Desktop archive changed during inspection');
  return { sha512: hash.digest('base64'), size: before.size };
}
