/**
 * Native trust-store adapters (see docs/optional-http2.md §4).
 *
 * Each adapter installs/removes the local CA in one platform store using fixed
 * argument arrays. Removal ALWAYS re-reads the actual installed certificate and
 * compares its full DER fingerprint to the CA we own before deleting — never by
 * display name or serial alone, and never touching a pre-existing or supplied
 * certificate. Failures return structured outcomes instead of throwing.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import type { NativeRunner, TrustAdapter, TrustResult } from './types';

// ─── Certificate fingerprint helpers (Node built-ins) ───────────────────────

function sha256OfPem(pem: string): string | null {
  try {
    return new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Split a bundle of concatenated PEM certificates into individual blocks. */
function splitPemBlocks(bundle: string): string[] {
  return [...bundle.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(
    (m) => m[0],
  );
}

function permissionDenied(res: { status: number | null; stderr: string; error?: string }): boolean {
  const text = `${res.stderr} ${res.error ?? ''}`.toLowerCase();
  return (
    res.error === 'EACCES' ||
    /permission denied|not authorized|access is denied|must be run as|operation not permitted|eacces|eperm/.test(
      text,
    )
  );
}

/**
 * A failed `certutil -L -n <nick>` means "not in this database" ONLY when it
 * says so. Any other failure (locked/unreadable DB, permission) is indeterminate
 * and must NOT be read as absence — otherwise removal would report success while
 * trust remains. Returns true only for a recognized not-found error.
 */
function looksAbsent(res: { stdout: string; stderr: string; error?: string }): boolean {
  const text = `${res.stdout} ${res.stderr} ${res.error ?? ''}`.toLowerCase();
  return /could not find|not found|pr_file_not_found|no such|does not exist/.test(text);
}

// ─── macOS system keychain ───────────────────────────────────────────────────

const SYSTEM_KEYCHAIN = '/Library/Keychains/System.keychain';

const macosAdapter: TrustAdapter = {
  id: 'macos-system',
  label: 'macOS system keychain',
  detect: (r) => r.platform === 'darwin',

  install(ctx): TrustResult {
    if (findMacCertSha1(ctx.runner, ctx.caFingerprintSha256)) {
      return { target: this.id, label: this.label, outcome: 'already-present' };
    }
    const res = ctx.runner.run('security', [
      'add-trusted-cert',
      '-d',
      '-r',
      'trustRoot',
      '-k',
      SYSTEM_KEYCHAIN,
      ctx.caCertPath,
    ]);
    if (res.status === 0) {
      return { target: this.id, label: this.label, outcome: 'installed', owned: true };
    }
    if (permissionDenied(res)) {
      return {
        target: this.id,
        label: this.label,
        outcome: 'permission-denied',
        detail: 'Admin authorization was declined or unavailable.',
      };
    }
    return { target: this.id, label: this.label, outcome: 'error', detail: res.stderr.trim() };
  },

  remove(ctx): TrustResult {
    const sha1 = findMacCertSha1(ctx.runner, ctx.caFingerprintSha256);
    if (!sha1) return { target: this.id, label: this.label, outcome: 'not-present' };

    // Remove the admin trust settings, then delete the owned certificate by its
    // SHA-1 hash (verified above to belong to our CA's DER).
    ctx.runner.run('security', ['remove-trusted-cert', '-d', ctx.caCertPath]);
    const del = ctx.runner.run('security', ['delete-certificate', '-Z', sha1, SYSTEM_KEYCHAIN]);
    if (del.status === 0) return { target: this.id, label: this.label, outcome: 'removed' };
    if (permissionDenied(del)) {
      return { target: this.id, label: this.label, outcome: 'permission-denied' };
    }
    return { target: this.id, label: this.label, outcome: 'error', detail: del.stderr.trim() };
  },
};

/**
 * Find our CA in the system keychain by DER fingerprint and return its SHA-1
 * hash (the delete key). Null if not present. Reads the certificates as PEM and
 * matches on the full SHA-256 DER fingerprint, never on name/serial.
 */
function findMacCertSha1(runner: NativeRunner, wantSha256: string): string | null {
  const res = runner.run('security', ['find-certificate', '-a', '-p', SYSTEM_KEYCHAIN]);
  if (res.status !== 0) return null;
  for (const block of splitPemBlocks(res.stdout)) {
    if (sha256OfPem(block) === wantSha256) {
      try {
        return new crypto.X509Certificate(block).fingerprint.replace(/:/g, '').toUpperCase();
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ─── Windows current-user Root store (certutil built-in, arg-array safe) ─────

const windowsAdapter: TrustAdapter = {
  id: 'windows-user-root',
  label: 'Windows current-user Root store',
  detect: (r) => r.platform === 'win32',

  install(ctx): TrustResult {
    // Thumbprint (SHA-1) is the store identity; a matching thumbprint is the
    // same certificate. `-user` keeps this out of the machine-wide store.
    const present = ctx.runner.run('certutil', ['-user', '-store', 'Root', ctx.caFingerprintSha1]);
    if (present.status === 0) {
      return { target: this.id, label: this.label, outcome: 'already-present' };
    }
    const res = ctx.runner.run('certutil', ['-user', '-addstore', 'Root', ctx.caCertPath]);
    if (res.status === 0) return { target: this.id, label: this.label, outcome: 'installed', owned: true };
    if (permissionDenied(res)) return { target: this.id, label: this.label, outcome: 'permission-denied' };
    return { target: this.id, label: this.label, outcome: 'error', detail: res.stderr.trim() };
  },

  remove(ctx): TrustResult {
    const present = ctx.runner.run('certutil', ['-user', '-store', 'Root', ctx.caFingerprintSha1]);
    if (present.status !== 0) return { target: this.id, label: this.label, outcome: 'not-present' };
    const res = ctx.runner.run('certutil', ['-user', '-delstore', 'Root', ctx.caFingerprintSha1]);
    if (res.status === 0) return { target: this.id, label: this.label, outcome: 'removed' };
    if (permissionDenied(res)) return { target: this.id, label: this.label, outcome: 'permission-denied' };
    return { target: this.id, label: this.label, outcome: 'error', detail: res.stderr.trim() };
  },
};

// ─── Linux shared-anchor stores (Debian/Ubuntu, Fedora/RHEL) ─────────────────

interface AnchorSpec {
  id: 'linux-debian' | 'linux-fedora';
  label: string;
  anchorDir: string;
  anchorFile: (installId: string) => string;
  refreshCmd: [string, string[]];
}

function anchorAdapter(spec: AnchorSpec): TrustAdapter {
  return {
    id: spec.id,
    label: spec.label,
    detect: (r) => r.platform === 'linux' && r.exists(spec.anchorDir),

    install(ctx): TrustResult {
      const file = spec.anchorFile(ctx.installId);
      const existing = ctx.runner.readFile(file);
      const present = !!existing && sha256OfPem(existing) === ctx.caFingerprintSha256;
      if (!present) {
        const write = ctx.runner.writeFile(file, ctx.caCertPem);
        if (!write.ok) {
          const denied = write.error === 'EACCES' || write.error === 'EPERM';
          return {
            target: this.id,
            label: this.label,
            outcome: denied ? 'permission-denied' : 'error',
            detail: denied
              ? `Writing ${spec.anchorDir} needs root. Re-run \`ri tls trust\` with sufficient privileges.`
              : write.error,
            owned: false,
          };
        }
      }
      // Always (re)build the bundle so a prior partial install (anchor written,
      // refresh never ran) converges rather than being skipped on retry.
      const refresh = ctx.runner.run(spec.refreshCmd[0], spec.refreshCmd[1]);
      if (refresh.status !== 0) {
        // The anchor is our uniquely-named file, so we own it even though the
        // rebuild failed. Keep it recorded so untrust can clean up / retry, and
        // so a later system refresh that picks it up is still removable.
        return {
          target: this.id,
          label: this.label,
          outcome: permissionDenied(refresh) ? 'permission-denied' : 'error',
          detail: refresh.stderr.trim(),
          owned: true,
        };
      }
      return {
        target: this.id,
        label: this.label,
        outcome: present ? 'already-present' : 'installed',
        owned: true,
      };
    },

    remove(ctx): TrustResult {
      const file = spec.anchorFile(ctx.installId);
      const existing = ctx.runner.readFile(file);
      // Verify the owned anchor's contents before touching it.
      if (existing && sha256OfPem(existing) !== ctx.caFingerprintSha256) {
        return {
          target: this.id,
          label: this.label,
          outcome: 'error',
          detail: 'Anchor file contents do not match the owned CA; leaving it in place.',
        };
      }
      if (existing) {
        const del = ctx.runner.removeFile(file);
        if (!del.ok) {
          const denied = del.error === 'EACCES' || del.error === 'EPERM';
          return {
            target: this.id,
            label: this.label,
            outcome: denied ? 'permission-denied' : 'error',
            detail: del.error,
          };
        }
      }
      // Rebuild the trust bundle whether or not the anchor was present this call:
      // a prior partial removal (file deleted, refresh never ran) must still
      // converge. Report `removed` only after a successful refresh, so the
      // ownership record survives a refresh failure and the removal can retry.
      const refresh = ctx.runner.run(spec.refreshCmd[0], spec.refreshCmd[1]);
      if (refresh.status === 0) return { target: this.id, label: this.label, outcome: 'removed' };
      if (permissionDenied(refresh)) {
        return { target: this.id, label: this.label, outcome: 'permission-denied' };
      }
      return { target: this.id, label: this.label, outcome: 'error', detail: refresh.stderr.trim() };
    },
  };
}

const debianAdapter = anchorAdapter({
  id: 'linux-debian',
  label: 'Debian/Ubuntu system trust',
  anchorDir: '/usr/local/share/ca-certificates',
  anchorFile: (id) => `/usr/local/share/ca-certificates/ri-local-ca-${id}.crt`,
  refreshCmd: ['update-ca-certificates', []],
});

const fedoraAdapter = anchorAdapter({
  id: 'linux-fedora',
  label: 'Fedora/RHEL shared system trust',
  anchorDir: '/etc/pki/ca-trust/source/anchors',
  anchorFile: (id) => `/etc/pki/ca-trust/source/anchors/ri-local-ca-${id}.pem`,
  refreshCmd: ['update-ca-trust', ['extract']],
});

// ─── Linux NSS databases (Chromium, Firefox) ─────────────────────────────────

function nssNickname(installId: string): string {
  return `Ri Local CA ${installId.slice(0, 8)}`;
}

/** Chromium's current-user NSS DB, using the documented legacy-path precedence. */
function chromiumNssDb(runner: NativeRunner): string | null {
  const primary = path.join(runner.homedir, '.pki', 'nssdb');
  if (runner.exists(primary)) return primary;
  const legacy = path.join(runner.homedir, '.local', 'share', 'pki', 'nssdb');
  if (runner.exists(legacy)) return legacy;
  return null;
}

/** Firefox current-user profile directories containing an NSS database. */
function firefoxProfileDirs(runner: NativeRunner): string[] {
  const base = path.join(runner.homedir, '.mozilla', 'firefox');
  const iniText = runner.readFile(path.join(base, 'profiles.ini'));
  if (!iniText) return [];
  const dirs: string[] = [];
  let relative = true;
  let profilePath: string | null = null;
  const flush = () => {
    if (profilePath) {
      const dir = relative ? path.join(base, profilePath) : profilePath;
      if (runner.exists(path.join(dir, 'cert9.db')) || runner.exists(path.join(dir, 'cert8.db'))) {
        dirs.push(dir);
      }
    }
    profilePath = null;
    relative = true;
  };
  for (const line of iniText.split(/\r?\n/)) {
    if (/^\[Profile/i.test(line)) {
      flush();
    } else if (/^IsRelative\s*=/i.test(line)) {
      relative = line.split('=')[1].trim() !== '0';
    } else if (/^Path\s*=/i.test(line)) {
      profilePath = line.split('=')[1].trim();
    }
  }
  flush();
  return dirs;
}

interface NssTarget {
  id: 'nss-chromium' | 'nss-firefox';
  label: string;
  dirs(runner: NativeRunner): string[];
}

function nssAdapter(spec: NssTarget): TrustAdapter {
  return {
    id: spec.id,
    label: spec.label,
    detect: (r) => r.platform === 'linux' && !!r.which('certutil') && spec.dirs(r).length > 0,

    install(ctx): TrustResult {
      if (!ctx.runner.which('certutil')) {
        return {
          target: this.id,
          label: this.label,
          outcome: 'missing-tool',
          detail:
            'certutil (libnss3-tools) is required for browser NSS trust. Install it, or import the CA manually.',
        };
      }
      const dirs = spec.dirs(ctx.runner);
      if (dirs.length === 0) return { target: this.id, label: this.label, outcome: 'profile-unavailable' };
      const nickname = nssNickname(ctx.installId);
      const addedDirs: string[] = [];
      let present = 0;
      for (const dir of dirs) {
        const shown = ctx.runner.run('certutil', ['-d', `sql:${dir}`, '-L', '-n', nickname, '-a']);
        if (shown.status === 0 && sha256OfPem(shown.stdout) === ctx.caFingerprintSha256) {
          present += 1;
          continue; // already present in this DB — we are not adding it here
        }
        const add = ctx.runner.run('certutil', [
          '-d',
          `sql:${dir}`,
          '-A',
          '-t',
          'C,,',
          '-n',
          nickname,
          '-i',
          ctx.caCertPath,
        ]);
        if (add.status === 0) addedDirs.push(dir);
      }
      // Own only the profiles we actually added to. A profile that already
      // trusted the CA is reported present but never claimed, so untrust will
      // not remove trust from a profile Ri did not install into.
      if (addedDirs.length > 0) {
        return {
          target: this.id,
          label: this.label,
          outcome: 'installed',
          owned: true,
          ownedProfiles: addedDirs,
          detail: `${addedDirs.length} database(s)`,
        };
      }
      if (present > 0) {
        return { target: this.id, label: this.label, outcome: 'already-present', owned: false };
      }
      return { target: this.id, label: this.label, outcome: 'error', owned: false, detail: 'certutil add failed' };
    },

    remove(ctx, ownedProfiles): TrustResult {
      if (!ctx.runner.which('certutil')) {
        return { target: this.id, label: this.label, outcome: 'missing-tool' };
      }
      // Only ever operate on the profiles this install recorded adding to; never
      // re-scan and touch a profile that already trusted the CA independently.
      const dirs = ownedProfiles && ownedProfiles.length > 0 ? ownedProfiles : spec.dirs(ctx.runner);
      const nickname = nssNickname(ctx.installId);
      let present = 0;
      let removed = 0;
      let failures = 0;
      let foreign = 0;
      let inspectErrors = 0;
      for (const dir of dirs) {
        const shown = ctx.runner.run('certutil', ['-d', `sql:${dir}`, '-L', '-n', nickname, '-a']);
        if (shown.status !== 0) {
          // Only a recognized not-found means the nickname is absent here. Any
          // other -L failure is indeterminate and must not be read as absence,
          // or we would report success while trust remains.
          if (looksAbsent(shown)) continue;
          inspectErrors += 1;
          continue;
        }
        present += 1;
        // Verify the certificate behind the nickname is ours before deleting.
        if (sha256OfPem(shown.stdout) !== ctx.caFingerprintSha256) {
          foreign += 1;
          continue;
        }
        const del = ctx.runner.run('certutil', ['-d', `sql:${dir}`, '-D', '-n', nickname]);
        if (del.status === 0) removed += 1;
        else failures += 1;
      }
      // An unreadable profile leaves cleanup unverified → keep the record.
      if (inspectErrors > 0) {
        return {
          target: this.id,
          label: this.label,
          outcome: 'error',
          detail: `could not inspect ${inspectErrors} profile(s); retry to finish`,
        };
      }
      if (present === 0) return { target: this.id, label: this.label, outcome: 'not-present' };
      if (foreign === present) {
        return { target: this.id, label: this.label, outcome: 'error', detail: 'nickname found but not owned' };
      }
      // Only report `removed` when every owned copy is gone; a partial removal
      // keeps the record so the remaining profiles can be retried.
      if (failures === 0 && foreign === 0) {
        return { target: this.id, label: this.label, outcome: 'removed', detail: `${removed} database(s)` };
      }
      return {
        target: this.id,
        label: this.label,
        outcome: 'error',
        detail: `removed ${removed}/${present} profile(s); retry to finish`,
      };
    },
  };
}

const chromiumNssAdapter = nssAdapter({
  id: 'nss-chromium',
  label: 'Linux Chromium NSS database',
  dirs: (r) => {
    const db = chromiumNssDb(r);
    return db ? [db] : [];
  },
});

const firefoxNssAdapter = nssAdapter({
  id: 'nss-firefox',
  label: 'Firefox NSS profiles',
  dirs: firefoxProfileDirs,
});

export const ALL_ADAPTERS: TrustAdapter[] = [
  macosAdapter,
  windowsAdapter,
  debianAdapter,
  fedoraAdapter,
  chromiumNssAdapter,
  firefoxNssAdapter,
];

/** Adapters applicable on the current machine. */
export function detectAdapters(runner: NativeRunner): TrustAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.detect(runner));
}

export { sha256OfPem, splitPemBlocks };
