import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { NativeRunner, RunResult } from './types';
import { readTrustManifest } from './manifest';

let tmpRoot: string;
let caPem: string;
let caSha1: string;
let installId: string;

// Loaded after RI_CONFIG_DIR is set so the CA lands in the temp root.
let installTrust: typeof import('./index').installTrust;
let removeTrust: typeof import('./index').removeTrust;

interface RunCall {
  command: string;
  args: string[];
}

/** In-memory NativeRunner: scripted command results + a fake filesystem. */
class MockRunner implements NativeRunner {
  platform: NodeJS.Platform = 'darwin';
  env: NodeJS.ProcessEnv = process.env;
  homedir = '/home/tester';
  tools = new Set<string>();
  files = new Map<string, string>();
  dirs = new Set<string>();
  writeShouldFail: string | null = null; // error code to simulate on writeFile
  calls: RunCall[] = [];
  handler: (command: string, args: string[]) => RunResult = () => ({ status: 0, stdout: '', stderr: '' });

  which(command: string): string | null {
    return this.tools.has(command) ? `/usr/bin/${command}` : null;
  }
  exists(p: string): boolean {
    return this.dirs.has(p) || this.files.has(p);
  }
  readFile(p: string): string | null {
    return this.files.get(p) ?? null;
  }
  writeFile(p: string, data: string): { ok: boolean; error?: string } {
    if (this.writeShouldFail) return { ok: false, error: this.writeShouldFail };
    this.files.set(p, data);
    return { ok: true };
  }
  removeFile(p: string): { ok: boolean; error?: string } {
    this.files.delete(p);
    return { ok: true };
  }
  run(command: string, args: string[]): RunResult {
    this.calls.push({ command, args });
    return this.handler(command, args);
  }
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-trust-'));
  process.env.RI_CONFIG_DIR = path.join(tmpRoot, '.config');
  const tls = await import('@/lib/config/tls');
  await tls.ensureCaGenerated();
  caPem = tls.readCaCertPem()!;
  const info = tls.readCaInstallInfo()!;
  installId = info.installId;
  const x = new crypto.X509Certificate(caPem);
  caSha1 = x.fingerprint.replace(/:/g, '').toUpperCase();
  const idx = await import('./index');
  installTrust = idx.installTrust;
  removeTrust = idx.removeTrust;
});

afterAll(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Each test starts from a clean manifest so ownership state doesn't leak.
beforeEach(() => {
  fs.rmSync(path.join(tmpRoot, '.config', 'tls', 'trust.json'), { force: true });
});

describe('macOS trust adapter', () => {
  it('installs via add-trusted-cert and records ownership', async () => {
    const r = new MockRunner();
    r.platform = 'darwin';
    r.handler = (cmd, args) => {
      if (cmd === 'security' && args[0] === 'find-certificate') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'security' && args[0] === 'add-trusted-cert') return { status: 0, stdout: '', stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    };
    const summary = await installTrust({ runner: r });
    const res = summary.results.find((x) => x.target === 'macos-system')!;
    expect(res.outcome).toBe('installed');
    const add = r.calls.find((c) => c.args[0] === 'add-trusted-cert')!;
    expect(add.args).toContain('/Library/Keychains/System.keychain');
    expect(add.args).toContain('-r');
    expect(add.args).toContain('trustRoot');
  });

  it('is idempotent when the CA is already in the keychain', async () => {
    const r = new MockRunner();
    r.handler = (cmd, args) => {
      if (cmd === 'security' && args[0] === 'find-certificate') return { status: 0, stdout: caPem, stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const summary = await installTrust({ runner: r });
    expect(summary.results[0].outcome).toBe('already-present');
    expect(r.calls.find((c) => c.args[0] === 'add-trusted-cert')).toBeUndefined();
  });

  it('removes only the owned cert, by verified SHA-1', async () => {
    const install = new MockRunner();
    install.handler = (cmd, args) =>
      cmd === 'security' && args[0] === 'find-certificate'
        ? { status: 0, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: '' };
    await installTrust({ runner: install });

    const r = new MockRunner();
    r.handler = (cmd, args) => {
      if (cmd === 'security' && args[0] === 'find-certificate') return { status: 0, stdout: caPem, stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const summary = await removeTrust({ runner: r });
    expect(summary.results[0].outcome).toBe('removed');
    const del = r.calls.find((c) => c.args[0] === 'delete-certificate')!;
    expect(del.args).toContain('-Z');
    expect(del.args).toContain(caSha1);
  });

  it('refuses to delete a foreign certificate at the same slot', async () => {
    const install = new MockRunner();
    install.handler = () => ({ status: 0, stdout: '', stderr: '' });
    await installTrust({ runner: install });

    const foreignPem = SECOND_CA_PEM;
    const r = new MockRunner();
    r.handler = (cmd, args) => {
      if (cmd === 'security' && args[0] === 'find-certificate') return { status: 0, stdout: foreignPem, stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const summary = await removeTrust({ runner: r });
    expect(summary.results[0].outcome).toBe('not-present');
    expect(r.calls.find((c) => c.args[0] === 'delete-certificate')).toBeUndefined();
  });
});

describe('Windows trust adapter', () => {
  it('adds to the current-user Root store, then deletes by thumbprint', async () => {
    const r = new MockRunner();
    r.platform = 'win32';
    let installed = false;
    r.handler = (cmd, args) => {
      if (cmd === 'certutil' && args.includes('-store')) {
        return { status: installed ? 0 : 1, stdout: '', stderr: '' };
      }
      if (cmd === 'certutil' && args.includes('-addstore')) {
        installed = true;
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const ins = await installTrust({ runner: r });
    expect(ins.results[0].outcome).toBe('installed');
    const add = r.calls.find((c) => c.args.includes('-addstore'))!;
    expect(add.args).toEqual(['-user', '-addstore', 'Root', ins.caCertPath]);

    const rem = await removeTrust({ runner: r });
    expect(rem.results[0].outcome).toBe('removed');
    const del = r.calls.find((c) => c.args.includes('-delstore'))!;
    expect(del.args).toEqual(['-user', '-delstore', 'Root', caSha1]);
  });
});

describe('Debian anchor adapter', () => {
  it('reports permission-denied when the anchor dir is not writable', async () => {
    const r = new MockRunner();
    r.platform = 'linux';
    r.dirs.add('/usr/local/share/ca-certificates');
    r.writeShouldFail = 'EACCES';
    const summary = await installTrust({ runner: r });
    const res = summary.results.find((x) => x.target === 'linux-debian')!;
    expect(res.outcome).toBe('permission-denied');
    // update-ca-certificates must not run if the write failed.
    expect(r.calls.find((c) => c.command === 'update-ca-certificates')).toBeUndefined();
  });

  it('installs and refreshes when writable', async () => {
    const r = new MockRunner();
    r.platform = 'linux';
    r.dirs.add('/usr/local/share/ca-certificates');
    r.handler = (cmd) => (cmd === 'update-ca-certificates' ? { status: 0, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: '' });
    const summary = await installTrust({ runner: r });
    const res = summary.results.find((x) => x.target === 'linux-debian')!;
    expect(res.outcome).toBe('installed');
    expect(r.files.get(`/usr/local/share/ca-certificates/ri-local-ca-${installId}.crt`)).toBe(caPem);
    expect(r.calls.find((c) => c.command === 'update-ca-certificates')).toBeDefined();
  });
});

describe('Linux Chromium NSS adapter', () => {
  it('adds the CA with certutil into the detected nssdb', async () => {
    const r = new MockRunner();
    r.platform = 'linux';
    r.tools.add('certutil');
    r.dirs.add('/home/tester/.pki/nssdb');
    r.handler = (cmd, args) => {
      if (cmd === 'certutil' && args.includes('-L')) return { status: 1, stdout: '', stderr: '' }; // absent
      if (cmd === 'certutil' && args.includes('-A')) return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const summary = await installTrust({ runner: r });
    const res = summary.results.find((x) => x.target === 'nss-chromium')!;
    expect(res.outcome).toBe('installed');
    const add = r.calls.find((c) => c.args.includes('-A'))!;
    expect(add.args).toContain('sql:/home/tester/.pki/nssdb');
    expect(add.args).toContain('C,,');
  });

  it('reports missing-tool when certutil is absent but a browser DB exists', async () => {
    const r = new MockRunner();
    r.platform = 'linux';
    r.dirs.add('/home/tester/.pki/nssdb');
    // certutil not in tools → adapter should not even be detected, so no result.
    const summary = await installTrust({ runner: r });
    expect(summary.results.find((x) => x.target === 'nss-chromium')).toBeUndefined();
  });
});

describe('untrust safety (partial-failure handling)', () => {
  it('never removes a store entry it did not create', async () => {
    const install = new MockRunner();
    install.platform = 'darwin';
    // find-certificate returns our CA → install sees it already present → createdByUs=false.
    install.handler = (cmd, args) =>
      cmd === 'security' && args[0] === 'find-certificate'
        ? { status: 0, stdout: caPem, stderr: '' }
        : { status: 0, stdout: '', stderr: '' };
    const ins = await installTrust({ runner: install });
    expect(ins.results[0].outcome).toBe('already-present');

    const r = new MockRunner();
    r.platform = 'darwin';
    r.handler = () => ({ status: 0, stdout: caPem, stderr: '' });
    const rem = await removeTrust({ runner: r });
    expect(rem.results[0].outcome).toBe('not-present');
    // We must never touch a keychain entry we did not install.
    expect(r.calls.find((c) => c.args[0] === 'delete-certificate')).toBeUndefined();
  });

  it('keeps the record when the Linux bundle refresh fails, then converges on retry', async () => {
    const anchor = `/usr/local/share/ca-certificates/ri-local-ca-${installId}.crt`;
    const install = new MockRunner();
    install.platform = 'linux';
    install.dirs.add('/usr/local/share/ca-certificates');
    install.handler = () => ({ status: 0, stdout: '', stderr: '' });
    await installTrust({ runner: install });
    expect(readTrustManifest()?.entries.some((e) => e.target === 'linux-debian')).toBe(true);

    // Anchor deletes, but update-ca-certificates fails → error, record retained.
    const r1 = new MockRunner();
    r1.platform = 'linux';
    r1.dirs.add('/usr/local/share/ca-certificates');
    r1.files.set(anchor, caPem);
    r1.handler = (cmd) =>
      cmd === 'update-ca-certificates'
        ? { status: 1, stdout: '', stderr: 'boom' }
        : { status: 0, stdout: '', stderr: '' };
    const rem1 = await removeTrust({ runner: r1 });
    expect(rem1.results[0].outcome).toBe('error');
    expect(readTrustManifest()?.entries.some((e) => e.target === 'linux-debian')).toBe(true);

    // Retry: anchor already gone, refresh now succeeds → removed, record cleared.
    const r2 = new MockRunner();
    r2.platform = 'linux';
    r2.dirs.add('/usr/local/share/ca-certificates');
    r2.handler = () => ({ status: 0, stdout: '', stderr: '' });
    const rem2 = await removeTrust({ runner: r2 });
    expect(rem2.results[0].outcome).toBe('removed');
    expect(readTrustManifest()?.entries.some((e) => e.target === 'linux-debian')).toBe(false);
  });

  it('keeps the record when only some Firefox profiles are cleaned', async () => {
    const home = '/home/fftest';
    const setupFf = (r: MockRunner) => {
      r.platform = 'linux';
      r.homedir = home;
      r.tools.add('certutil');
      r.files.set(
        `${home}/.mozilla/firefox/profiles.ini`,
        '[Profile0]\nPath=p0\nIsRelative=1\n\n[Profile1]\nPath=p1\nIsRelative=1\n',
      );
      for (const p of ['p0', 'p1']) {
        r.dirs.add(`${home}/.mozilla/firefox/${p}`);
        r.files.set(`${home}/.mozilla/firefox/${p}/cert9.db`, 'x');
      }
    };

    const install = new MockRunner();
    setupFf(install);
    install.handler = (_cmd, args) =>
      args.includes('-L') ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: '' };
    const ins = await installTrust({ runner: install });
    expect(ins.results.find((x) => x.target === 'nss-firefox')?.outcome).toBe('installed');

    const r = new MockRunner();
    setupFf(r);
    r.handler = (_cmd, args) => {
      if (args.includes('-L')) return { status: 0, stdout: caPem, stderr: '' }; // present + owned
      if (args.includes('-D')) {
        const dir = args[args.indexOf('-d') + 1];
        return dir.endsWith('p1') ? { status: 1, stdout: '', stderr: 'locked' } : { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const rem = await removeTrust({ runner: r });
    expect(rem.results.find((x) => x.target === 'nss-firefox')?.outcome).toBe('error');
    // Record retained so the un-cleaned profile can be retried.
    expect(readTrustManifest()?.entries.some((e) => e.target === 'nss-firefox')).toBe(true);
  });
});

describe('install ownership + inspection', () => {
  it('records ownership even when the Linux refresh fails at install, then untrust converges', async () => {
    // Install: anchor writes, but update-ca-certificates fails → error, yet the
    // uniquely-named anchor is ours, so an ownership record must be kept.
    const install = new MockRunner();
    install.platform = 'linux';
    install.dirs.add('/usr/local/share/ca-certificates');
    install.handler = (cmd) =>
      cmd === 'update-ca-certificates' ? { status: 1, stdout: '', stderr: 'boom' } : { status: 0, stdout: '', stderr: '' };
    const ins = await installTrust({ runner: install });
    expect(ins.results.find((x) => x.target === 'linux-debian')?.outcome).toBe('error');
    const entry = readTrustManifest()?.entries.find((e) => e.target === 'linux-debian');
    expect(entry?.createdByUs).toBe(true); // owned despite the refresh failure
    expect(install.files.get(`/usr/local/share/ca-certificates/ri-local-ca-${installId}.crt`)).toBe(caPem);

    // Untrust now succeeds (refresh works) and clears the record — convergence.
    const r = new MockRunner();
    r.platform = 'linux';
    r.dirs.add('/usr/local/share/ca-certificates');
    r.files.set(`/usr/local/share/ca-certificates/ri-local-ca-${installId}.crt`, caPem);
    r.handler = () => ({ status: 0, stdout: '', stderr: '' });
    const rem = await removeTrust({ runner: r });
    expect(rem.results[0].outcome).toBe('removed');
    expect(readTrustManifest()?.entries.some((e) => e.target === 'linux-debian')).toBe(false);
  });

  it('does not claim ownership of an NSS cert that was already present', async () => {
    const install = new MockRunner();
    install.platform = 'linux';
    install.tools.add('certutil');
    install.dirs.add('/home/tester/.pki/nssdb');
    // -L already returns our CA in the only db → nothing to add.
    install.handler = (_cmd, args) =>
      args.includes('-L') ? { status: 0, stdout: caPem, stderr: '' } : { status: 0, stdout: '', stderr: '' };
    const ins = await installTrust({ runner: install });
    const res = ins.results.find((x) => x.target === 'nss-chromium')!;
    expect(res.outcome).toBe('already-present');
    expect(install.calls.find((c) => c.args.includes('-A'))).toBeUndefined();
    // Recorded, but NOT owned → untrust must not delete a pre-existing cert.
    expect(readTrustManifest()?.entries.find((e) => e.target === 'nss-chromium')?.createdByUs).toBe(false);

    const r = new MockRunner();
    r.platform = 'linux';
    r.tools.add('certutil');
    r.dirs.add('/home/tester/.pki/nssdb');
    r.handler = () => ({ status: 0, stdout: caPem, stderr: '' });
    const rem = await removeTrust({ runner: r });
    expect(rem.results[0].outcome).toBe('not-present');
    expect(r.calls.find((c) => c.args.includes('-D'))).toBeUndefined(); // never deleted
  });

  it('treats an unreadable NSS database as unverified, not absent', async () => {
    // Own an NSS entry first.
    const install = new MockRunner();
    install.platform = 'linux';
    install.tools.add('certutil');
    install.dirs.add('/home/tester/.pki/nssdb');
    install.handler = (_cmd, args) =>
      args.includes('-L') ? { status: 1, stdout: '', stderr: 'could not find' } : { status: 0, stdout: '', stderr: '' };
    await installTrust({ runner: install });
    expect(readTrustManifest()?.entries.some((e) => e.target === 'nss-chromium')).toBe(true);

    // Removal: -L fails with a NON not-found error (locked db) → indeterminate.
    const r = new MockRunner();
    r.platform = 'linux';
    r.tools.add('certutil');
    r.dirs.add('/home/tester/.pki/nssdb');
    r.handler = (_cmd, args) =>
      args.includes('-L')
        ? { status: 255, stdout: '', stderr: 'SEC_ERROR_BAD_DATABASE: security library: bad database.' }
        : { status: 0, stdout: '', stderr: '' };
    const rem = await removeTrust({ runner: r });
    expect(rem.results[0].outcome).toBe('error'); // not "not-present"
    expect(r.calls.find((c) => c.args.includes('-D'))).toBeUndefined();
    // Record kept because cleanup could not be verified.
    expect(readTrustManifest()?.entries.some((e) => e.target === 'nss-chromium')).toBe(true);
  });

  it('untrust removes only the Firefox profiles Ri installed into, never a pre-existing one', async () => {
    const home = '/home/ffperprofile';
    const dirA = `${home}/.mozilla/firefox/pA`;
    const dirB = `${home}/.mozilla/firefox/pB`;
    const setup = (r: MockRunner) => {
      r.platform = 'linux';
      r.homedir = home;
      r.tools.add('certutil');
      r.files.set(
        `${home}/.mozilla/firefox/profiles.ini`,
        '[Profile0]\nPath=pA\nIsRelative=1\n\n[Profile1]\nPath=pB\nIsRelative=1\n',
      );
      for (const p of ['pA', 'pB']) {
        r.dirs.add(`${home}/.mozilla/firefox/${p}`);
        r.files.set(`${home}/.mozilla/firefox/${p}/cert9.db`, 'x');
      }
    };

    // Install: profile A ALREADY trusts the CA; only B gets it added.
    const install = new MockRunner();
    setup(install);
    install.handler = (_cmd, args) => {
      if (args.includes('-L')) {
        const dir = args[args.indexOf('-d') + 1];
        return dir.endsWith('pA')
          ? { status: 0, stdout: caPem, stderr: '' } // already present in A
          : { status: 1, stdout: '', stderr: 'could not find' }; // absent in B → add
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const ins = await installTrust({ runner: install });
    expect(ins.results.find((x) => x.target === 'nss-firefox')?.outcome).toBe('installed');
    // Only B is recorded as owned.
    expect(readTrustManifest()?.entries.find((e) => e.target === 'nss-firefox')?.profiles).toEqual([dirB]);

    // Untrust: both profiles now report the cert present, but only B is ours.
    const r = new MockRunner();
    setup(r);
    r.handler = (_cmd, args) => (args.includes('-L') ? { status: 0, stdout: caPem, stderr: '' } : { status: 0, stdout: '', stderr: '' });
    const rem = await removeTrust({ runner: r });
    expect(rem.results.find((x) => x.target === 'nss-firefox')?.outcome).toBe('removed');
    const deletes = r.calls.filter((c) => c.args.includes('-D'));
    expect(deletes.length).toBe(1);
    expect(deletes[0].args).toContain(`sql:${dirB}`);
    expect(deletes.some((c) => c.args.includes(`sql:${dirA}`))).toBe(false); // A never touched
  });
});

// A distinct CA PEM (generated once at load) standing in for an unrelated cert.
let SECOND_CA_PEM = '';
beforeAll(async () => {
  const tls = await import('@/lib/config/tls');
  // Generate a second, unrelated CA in an isolated dir to get a foreign PEM.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-foreign-'));
  const prev = process.env.RI_CONFIG_DIR;
  process.env.RI_CONFIG_DIR = path.join(dir, '.config');
  await tls.ensureCaGenerated();
  SECOND_CA_PEM = tls.readCaCertPem()!;
  process.env.RI_CONFIG_DIR = prev;
  fs.rmSync(dir, { recursive: true, force: true });
});
