/**
 * Trust orchestration (see docs/optional-http2.md §4). Ties the CA material,
 * the ownership manifest, and the native adapters together for the explicit
 * `ri tls trust` / `ri tls untrust` commands. Trust is NEVER performed as a
 * side effect of ordinary startup.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ensureCaGenerated,
  getCaCertPath,
  getTlsDir,
  readCaCertPem,
  readCaInstallInfo,
} from '@/lib/config/tls';
import { createNativeRunner } from './runner';
import { ALL_ADAPTERS, detectAdapters } from './adapters';
import type { NativeRunner, TrustAdapter, TrustContext, TrustResult, TrustTargetId } from './types';
import {
  findEntry,
  journalBegin,
  journalComplete,
  loadOrInitManifest,
  readTrustManifest,
  removeEntryRecord,
  upsertEntry,
  type TrustManifest,
} from './manifest';

export type { TrustResult, TrustTargetId } from './types';

export interface TrustRunSummary {
  results: TrustResult[];
  installId: string;
  caCertPath: string;
  caFingerprintSha256: string;
}

function buildContext(runner: NativeRunner, caCertPem: string, installId: string, fpSha256: string): TrustContext {
  const cert = new crypto.X509Certificate(caCertPem);
  return {
    runner,
    caCertPath: caCertMaterialPath(caCertPem),
    caCertPem,
    caFingerprintSha256: fpSha256,
    caFingerprintSha1: cert.fingerprint.replace(/:/g, '').toUpperCase(),
    installId,
  };
}

/**
 * Path to a CA cert file for native tools. Prefer the generated file; if it is
 * gone (e.g. during untrust after a manual cleanup) materialize a temp copy
 * from the manifest so identity checks still work.
 */
function caCertMaterialPath(caCertPem: string): string {
  const real = getCaCertPath();
  if (fs.existsSync(real)) return real;
  const tmp = path.join(getTlsDir(), 'ca-identify.pem');
  try {
    fs.mkdirSync(getTlsDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, caCertPem, { mode: 0o600 });
  } catch {
    /* best-effort */
  }
  return tmp;
}

/** Union of previously- and newly-owned per-location profiles (deduped). */
function mergeProfiles(prior: string[] | undefined, added: string[] | undefined): string[] {
  return [...new Set([...(prior ?? []), ...(added ?? [])])];
}

function entryIdentifier(adapter: TrustAdapter, ctx: TrustContext): string {
  switch (adapter.id) {
    case 'macos-system':
      return `sha256:${ctx.caFingerprintSha256}`;
    case 'windows-user-root':
      return `thumbprint:${ctx.caFingerprintSha1}`;
    case 'linux-debian':
      return `/usr/local/share/ca-certificates/ri-local-ca-${ctx.installId}.crt`;
    case 'linux-fedora':
      return `/etc/pki/ca-trust/source/anchors/ri-local-ca-${ctx.installId}.pem`;
    default:
      return `nickname:Ri Local CA ${ctx.installId.slice(0, 8)}`;
  }
}

interface Loaded {
  runner: NativeRunner;
  ctx: TrustContext;
  manifest: TrustManifest;
  installId: string;
  caFingerprintSha256: string;
}

async function load(runner: NativeRunner, ensure: boolean): Promise<Loaded | null> {
  if (ensure) await ensureCaGenerated();
  const info = readCaInstallInfo();
  const caCertPem = readCaCertPem() ?? readTrustManifest()?.caCertPem ?? null;
  const installId = info?.installId ?? readTrustManifest()?.installId ?? null;
  const fp = info?.caFingerprintSha256 ?? readTrustManifest()?.caFingerprintSha256 ?? null;
  if (!caCertPem || !installId || !fp) return null;

  const ctx = buildContext(runner, caCertPem, installId, fp);
  const manifest = loadOrInitManifest({
    installId,
    caFingerprintSha256: fp,
    caCertPem,
  });
  return { runner, ctx, manifest, installId, caFingerprintSha256: fp };
}

/**
 * Install the local CA into every supported native trust store detected on this
 * machine. Idempotent; safe to re-run to retry incomplete targets. Each result
 * reports the exact outcome so partial success is visible.
 */
export async function installTrust(opts: { runner?: NativeRunner } = {}): Promise<TrustRunSummary> {
  const runner = opts.runner ?? createNativeRunner();
  const loaded = await load(runner, true);
  if (!loaded) throw new Error('Could not load the local CA to trust.');
  const { ctx, manifest } = loaded;

  const adapters = detectAdapters(runner);
  const results: TrustResult[] = [];
  if (adapters.length === 0) {
    results.push({
      target: 'unsupported' as TrustTargetId,
      label: 'this platform',
      outcome: 'unsupported',
      detail: `No supported trust store detected. Import ${ctx.caCertPath} manually, or use --tls-cert/--tls-key.`,
    });
  }

  for (const adapter of adapters) {
    journalBegin(manifest, 'install', adapter.id);
    const result = adapter.install(ctx);
    // Record an ownership entry whenever we own the resulting entry — including
    // a partially-completed owned install (e.g. an anchor written but not yet
    // refreshed), so cleanup is never stranded. Ownership is sticky once set:
    // a re-run seeing `already-present` must not downgrade it. We never record
    // an entry we do not own (a pre-existing cert we merely found).
    const prior = findEntry(manifest, adapter.id);
    const owned = (prior?.createdByUs ?? false) || result.owned === true;
    if (owned || result.outcome === 'installed' || result.outcome === 'already-present') {
      // Accumulate owned per-location (NSS profiles) across retries so a later
      // run does not drop the locations an earlier run installed into.
      const profiles = mergeProfiles(prior?.profiles, result.ownedProfiles);
      upsertEntry(manifest, {
        target: adapter.id,
        identifier: entryIdentifier(adapter, ctx),
        createdByUs: owned,
        ...(profiles.length > 0 ? { profiles } : {}),
        installedAt: new Date().toISOString(),
      });
    }
    journalComplete(manifest, 'install', adapter.id);
    results.push(result);
  }

  return {
    results,
    installId: loaded.installId,
    caCertPath: ctx.caCertPath,
    caFingerprintSha256: loaded.caFingerprintSha256,
  };
}

/**
 * Remove only the trust entries this install owns. Never generates a CA. A
 * failed removal keeps its manifest record so it can be retried. Supplied
 * certificates and unrecorded pre-existing entries are never touched.
 */
export async function removeTrust(opts: { runner?: NativeRunner } = {}): Promise<TrustRunSummary> {
  const runner = opts.runner ?? createNativeRunner();
  const loaded = await load(runner, false);
  if (!loaded) {
    return { results: [], installId: '', caCertPath: '', caFingerprintSha256: '' };
  }
  const { ctx, manifest } = loaded;

  // Act on every target with an ownership record, plus any currently-detected
  // target that also has a record — the record is the authority for removal.
  const recorded = new Set(manifest.entries.map((e) => e.target));
  const adapters = ALL_ADAPTERS.filter((a) => recorded.has(a.id));

  const results: TrustResult[] = [];
  for (const adapter of adapters) {
    const entry = findEntry(manifest, adapter.id);
    if (!entry) continue;
    // Never mutate a store entry we did not create. If a prior install only
    // found the CA already present, drop our record and leave the store alone.
    if (!entry.createdByUs) {
      removeEntryRecord(manifest, adapter.id);
      results.push({
        target: adapter.id,
        label: adapter.label,
        outcome: 'not-present',
        detail: 'was already present before this install; left untouched',
      });
      continue;
    }
    journalBegin(manifest, 'remove', adapter.id);
    const result = adapter.remove(ctx, entry.profiles);
    // Clear the ownership record ONLY when trust is actually gone. A partial or
    // failed removal returns `error`/`permission-denied`, keeping the record so
    // it can be retried rather than stranding trust with no cleanup handle.
    if (result.outcome === 'removed' || result.outcome === 'not-present') {
      removeEntryRecord(manifest, adapter.id);
    }
    journalComplete(manifest, 'remove', adapter.id);
    results.push(result);
  }

  return {
    results,
    installId: loaded.installId,
    caCertPath: ctx.caCertPath,
    caFingerprintSha256: loaded.caFingerprintSha256,
  };
}

export interface TrustStatus {
  detected: { target: TrustTargetId; label: string }[];
  recorded: TrustTargetId[];
  caFingerprintSha256: string | null;
  caCertPath: string | null;
}

/** Report which targets apply here and which we have ownership records for. */
export function inspectTrust(opts: { runner?: NativeRunner } = {}): TrustStatus {
  const runner = opts.runner ?? createNativeRunner();
  const manifest = readTrustManifest();
  return {
    detected: detectAdapters(runner).map((a) => ({ target: a.id, label: a.label })),
    recorded: manifest?.entries.map((e) => e.target) ?? [],
    caFingerprintSha256: readCaInstallInfo()?.caFingerprintSha256 ?? manifest?.caFingerprintSha256 ?? null,
    caCertPath: readCaCertPem() ? getCaCertPath() : null,
  };
}
