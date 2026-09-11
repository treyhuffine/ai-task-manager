/**
 * Local TLS material for the optional HTTP/2 gateway (see docs/optional-http2.md §4).
 *
 * Two certificate sources:
 *   1. Generated — a per-install local CA plus a short-lived localhost leaf,
 *      created with `@peculiar/x509` over Node's WebCrypto. The CA is stable;
 *      the leaf rotates. Browser trust is a SEPARATE explicit step (see
 *      `tls-trust/`); generation alone changes no system trust.
 *   2. Supplied — a user-provided cert/key pair (`--tls-cert`/`--tls-key`),
 *      letting an existing trusted setup (e.g. mkcert) be reused as-is.
 *
 * This module is loaded only on the `--http2` path (the launcher lazy-imports
 * it), so its `reflect-metadata`/`@peculiar/x509` imports never initialize on
 * the default HTTP startup. Certificate INSPECTION and key-matching use Node's
 * built-in `crypto.X509Certificate`, so the trust layer needs no crypto library.
 *
 * On-disk layout under `getConfigDir()/tls/`:
 *   install.json                       { installId, caFingerprintSha256, createdAt }
 *   ca/ca.crt, ca/ca.key               stable CA (dir renamed into place atomically)
 *   leaf/manifest.json                 { current: "<versionId>" }
 *   leaf/versions/<id>/{leaf.crt,leaf.key}
 *   .lock/                             init/renewal mutex for this root
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { getConfigDir } from '@/lib/config/paths';
import type { SanEntry } from './tls-x509';

// Certificate generation lives in `./tls-x509`, imported dynamically so its
// `@peculiar/x509` / `reflect-metadata` dependencies never initialize on the
// default (no `--http2`) path. This module uses only Node built-ins.

// ─── Tunables (see §4 "Certificate generation decision") ──────────────────

const CA_YEARS = 5;
const LEAF_DAYS = 90;
/** Renew the leaf when fewer than this many days of validity remain. */
const LEAF_RENEW_WITHIN_DAYS = 30;
/** Backdate validity start to tolerate modest client clock skew. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** SANs the generated leaf must cover: localhost + loopback addresses only. */
const LEAF_SANS: SanEntry[] = [
  { type: 'dns', value: 'localhost' },
  { type: 'ip', value: '127.0.0.1' },
  { type: 'ip', value: '::1' },
];

// ─── Paths ────────────────────────────────────────────────────────────────

export function getTlsDir(): string {
  return path.join(getConfigDir(), 'tls');
}
function caDir(): string {
  return path.join(getTlsDir(), 'ca');
}
function caCertPath(): string {
  return path.join(caDir(), 'ca.crt');
}
/** Absolute path to the generated CA certificate, for native trust tools. */
export function getCaCertPath(): string {
  return caCertPath();
}
/** Ensure the local CA exists (no leaf), for a standalone `ri tls trust`. */
export async function ensureCaGenerated(): Promise<void> {
  await withTlsLock(async () => {
    await ensureCa();
  });
}
function caKeyPath(): string {
  return path.join(caDir(), 'ca.key');
}
function leafDir(): string {
  return path.join(getTlsDir(), 'leaf');
}
function leafManifestPath(): string {
  return path.join(leafDir(), 'manifest.json');
}
function leafVersionsDir(): string {
  return path.join(leafDir(), 'versions');
}
function installInfoPath(): string {
  return path.join(getTlsDir(), 'install.json');
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface TlsMaterial {
  /** PEM private key for the server leaf. */
  key: string;
  /** PEM leaf certificate (may include an appended chain for supplied certs). */
  cert: string;
  /**
   * PEM trust anchor a local Node client should use to validate this listener
   * during readiness probes. For generated material this is the local CA; for
   * supplied material it is the supplied certificate itself (exact-cert trust).
   */
  probeCa: string;
  source: 'generated' | 'supplied';
  /** Leaf validity end, for renewal scheduling and clear expiry reporting. */
  notAfter: Date;
}

export interface CaInstallInfo {
  version: 1;
  installId: string;
  /** Lowercase hex SHA-256 of the CA certificate DER (no separators). */
  caFingerprintSha256: string;
  createdAt: string;
}

// ─── Small fs helpers ─────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeFileAtomic(target: string, data: string, mode: number): void {
  const tmp = `${target}.${process.pid}.${Math.trunc(performance.now())}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, target);
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

// ─── Certificate inspection / matching (Node built-ins, no crypto lib) ──────

/** Lowercase hex SHA-256 of a certificate's DER, matching how trust entries key. */
export function certFingerprintSha256(certPem: string): string {
  return new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();
}

/**
 * True if `certPem`'s public key matches `keyPem`'s private key. Algorithm
 * agnostic: compares the SPKI DER derived from each side. Guards supplied
 * pairs and self-checks generated output before publishing.
 */
export function certKeyMatch(certPem: string, keyPem: string): boolean {
  try {
    const certPub = new crypto.X509Certificate(certPem).publicKey;
    const keyPub = crypto.createPublicKey(keyPem);
    const a = certPub.export({ type: 'spki', format: 'der' });
    const b = keyPub.export({ type: 'spki', format: 'der' });
    return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b);
  } catch {
    return false;
  }
}

function leafNotAfter(certPem: string): Date {
  return new Date(new crypto.X509Certificate(certPem).validTo);
}

// ─── Serialization lock ─────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialize initialization/renewal for this config root. Atomic `mkdir` is the
 * mutex; a lock whose owner PID is dead or that has aged past `staleMs` is
 * reclaimed so a crashed launcher can't wedge every future start.
 */
async function withTlsLock<T>(fn: () => Promise<T>): Promise<T> {
  ensureDir(getTlsDir());
  const lockPath = path.join(getTlsDir(), '.lock');
  const staleMs = 60_000;
  const deadline = Date.now() + 30_000;

  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid }));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const owner = readJson<{ pid: number }>(path.join(lockPath, 'owner.json'));
      let stale = false;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        const ownerDead = owner ? !isPidAlive(owner.pid) : true;
        stale = age > staleMs || ownerDead;
      } catch {
        stale = true;
      }
      if (stale) {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
          /* another waiter reclaimed it — retry */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for the TLS generation lock.');
      }
      await delay(100);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.rmSync(lockPath, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ─── Key + certificate generation (delegated to ./tls-x509, dynamic import) ──
//
// The heavy `@peculiar/x509` + `reflect-metadata` work lives in `./tls-x509`,
// imported dynamically so it initializes only when generation actually runs.

async function createCa(): Promise<{ certPem: string; keyPem: string }> {
  const gen = await import('./tls-x509');
  return gen.generateCaPair({ years: CA_YEARS, clockSkewMs: CLOCK_SKEW_MS });
}

async function createLeaf(caCertPem: string, caKeyPem: string): Promise<{ certPem: string; keyPem: string }> {
  const gen = await import('./tls-x509');
  return gen.generateLeafPair({
    caCertPem,
    caKeyPem,
    sans: LEAF_SANS,
    days: LEAF_DAYS,
    clockSkewMs: CLOCK_SKEW_MS,
  });
}

// ─── CA lifecycle ───────────────────────────────────────────────────────────

function caExists(): boolean {
  return fs.existsSync(caCertPath()) && fs.existsSync(caKeyPath());
}

/**
 * Ensure the local CA exists, generating it once. The CA files are written into
 * a temp directory and the directory is renamed into place, so a partially
 * written CA is never observed. Records install.json (installId + fingerprint).
 */
async function ensureCa(): Promise<void> {
  if (caExists()) return;
  const gen = await createCa();

  const tmp = path.join(getTlsDir(), `.ca.${process.pid}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  ensureDir(tmp);
  fs.writeFileSync(path.join(tmp, 'ca.crt'), gen.certPem, { mode: 0o600 });
  fs.writeFileSync(path.join(tmp, 'ca.key'), gen.keyPem, { mode: 0o600 });

  if (caExists()) {
    // Lost a race under the lock (shouldn't happen) — discard our temp.
    fs.rmSync(tmp, { recursive: true, force: true });
    return;
  }
  fs.renameSync(tmp, caDir());

  const info: CaInstallInfo = {
    version: 1,
    installId: uuidv7(),
    caFingerprintSha256: certFingerprintSha256(gen.certPem),
    createdAt: new Date().toISOString(),
  };
  writeFileAtomic(installInfoPath(), JSON.stringify(info, null, 2) + '\n', 0o600);
}

/** Public CA info for the trust layer. Null until the CA has been generated. */
export function readCaInstallInfo(): CaInstallInfo | null {
  return readJson<CaInstallInfo>(installInfoPath());
}

/** The local CA certificate PEM, or null if no generated CA exists. */
export function readCaCertPem(): string | null {
  try {
    return fs.readFileSync(caCertPath(), 'utf8');
  } catch {
    return null;
  }
}

// ─── Leaf lifecycle ─────────────────────────────────────────────────────────

function readCurrentLeaf(): { certPem: string; keyPem: string } | null {
  const manifest = readJson<{ version: number; current: string }>(leafManifestPath());
  if (!manifest?.current) return null;
  const dir = path.join(leafVersionsDir(), manifest.current);
  try {
    return {
      certPem: fs.readFileSync(path.join(dir, 'leaf.crt'), 'utf8'),
      keyPem: fs.readFileSync(path.join(dir, 'leaf.key'), 'utf8'),
    };
  } catch {
    return null;
  }
}

function leafNeedsRenewal(certPem: string): boolean {
  const msLeft = leafNotAfter(certPem).getTime() - Date.now();
  return msLeft < LEAF_RENEW_WITHIN_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Write a fresh leaf version and atomically flip the manifest pointer. The
 * cert+key are published as an inseparable pair via a versioned directory plus
 * a single-file manifest rename — two independent renames could expose a
 * mismatched cert/key window, which this avoids.
 */
async function renewLeaf(): Promise<{ certPem: string; keyPem: string }> {
  const caCertPem = fs.readFileSync(caCertPath(), 'utf8');
  const caKeyPem = fs.readFileSync(caKeyPath(), 'utf8');
  const leaf = await createLeaf(caCertPem, caKeyPem);

  if (!certKeyMatch(leaf.certPem, leaf.keyPem)) {
    throw new Error('Generated leaf certificate/key do not match; refusing to publish.');
  }

  const versionId = uuidv7();
  const versionDir = path.join(leafVersionsDir(), versionId);
  ensureDir(versionDir);
  fs.writeFileSync(path.join(versionDir, 'leaf.crt'), leaf.certPem, { mode: 0o600 });
  fs.writeFileSync(path.join(versionDir, 'leaf.key'), leaf.keyPem, { mode: 0o600 });

  writeFileAtomic(
    leafManifestPath(),
    JSON.stringify({ version: 1, current: versionId }, null, 2) + '\n',
    0o600,
  );

  // Best-effort prune of superseded versions.
  try {
    for (const entry of fs.readdirSync(leafVersionsDir())) {
      if (entry !== versionId) {
        fs.rmSync(path.join(leafVersionsDir(), entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* pruning is non-essential */
  }

  return leaf;
}

// ─── Public entry points ────────────────────────────────────────────────────

/**
 * Ensure generated TLS material exists and is valid, renewing the leaf if it is
 * missing or within the renewal window. Idempotent and serialized per root.
 */
export async function ensureGeneratedTls(): Promise<TlsMaterial> {
  return withTlsLock(async () => {
    await ensureCa();
    let leaf = readCurrentLeaf();
    if (!leaf || leafNeedsRenewal(leaf.certPem)) {
      leaf = await renewLeaf();
    }
    const probeCa = fs.readFileSync(caCertPath(), 'utf8');
    return {
      key: leaf.keyPem,
      cert: leaf.certPem,
      probeCa,
      source: 'generated',
      notAfter: leafNotAfter(leaf.certPem),
    };
  });
}

/**
 * Load a user-supplied certificate/key pair. Both paths are required together;
 * the pair is validated (parseable + matching) before use. The supplied
 * certificate itself is the readiness-probe trust anchor.
 */
export async function loadSuppliedTls(certPath: string, keyPath: string): Promise<TlsMaterial> {
  let cert: string;
  let key: string;
  try {
    cert = fs.readFileSync(certPath, 'utf8');
  } catch {
    throw new Error(`Could not read --tls-cert at ${certPath}`);
  }
  try {
    key = fs.readFileSync(keyPath, 'utf8');
  } catch {
    throw new Error(`Could not read --tls-key at ${keyPath}`);
  }
  if (!certKeyMatch(cert, key)) {
    throw new Error(
      `Supplied --tls-cert and --tls-key do not match (different public keys).`,
    );
  }
  // Reject a certificate that is already expired or not yet valid — the browser
  // would reject it too, so fail loudly here rather than starting a listener no
  // client can use. (Trust-chain validation is deferred to the readiness probe,
  // which cannot always see a private issuing CA.)
  let parsed: InstanceType<typeof crypto.X509Certificate>;
  try {
    parsed = new crypto.X509Certificate(cert);
  } catch {
    throw new Error(`Supplied --tls-cert at ${certPath} is not a valid certificate.`);
  }
  const now = Date.now();
  if (Number.isFinite(Date.parse(parsed.validTo)) && Date.parse(parsed.validTo) < now) {
    throw new Error(`Supplied --tls-cert expired on ${parsed.validTo}.`);
  }
  if (Number.isFinite(Date.parse(parsed.validFrom)) && Date.parse(parsed.validFrom) > now) {
    throw new Error(`Supplied --tls-cert is not valid until ${parsed.validFrom}.`);
  }
  return { key, cert, probeCa: cert, source: 'supplied', notAfter: leafNotAfter(cert) };
}

export interface ResolveTlsOptions {
  certPath?: string;
  keyPath?: string;
}

/**
 * Resolve the TLS material for a launch: supplied pair when both `--tls-cert`
 * and `--tls-key` are given (error if only one), otherwise the generated CA/leaf.
 */
export async function resolveTlsMaterial(opts: ResolveTlsOptions): Promise<TlsMaterial> {
  const hasCert = !!opts.certPath;
  const hasKey = !!opts.keyPath;
  if (hasCert !== hasKey) {
    throw new Error('Provide both --tls-cert and --tls-key, or neither.');
  }
  if (hasCert && hasKey) {
    return loadSuppliedTls(opts.certPath!, opts.keyPath!);
  }
  return ensureGeneratedTls();
}
