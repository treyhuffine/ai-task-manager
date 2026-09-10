/**
 * Trust ownership manifest (see docs/optional-http2.md §4 "Trust ownership and
 * removal"). Records the installation UUID, the CA DER fingerprint, the public
 * CA certificate, and each targeted store/profile entry this install created.
 *
 * A store mutation is journaled BEFORE it executes and marked complete after,
 * so an interruption can be reconciled: an install/remove that finds a
 * dangling journal entry re-verifies actual store state rather than trusting
 * the record. Removal consults this manifest so cleanup only ever touches
 * entries this install owns.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getTlsDir } from '@/lib/config/tls';
import type { TrustTargetId } from './types';

export interface TrustEntry {
  target: TrustTargetId;
  /** Store-specific handle: NSS nickname, anchor file path, or thumbprint. */
  identifier: string;
  /** True when this install created the entry (vs. found it already present). */
  createdByUs: boolean;
  /** Multi-location stores (NSS): the exact profiles THIS install added to, so
   *  untrust removes only from those. Absent for single-location stores. */
  profiles?: string[];
  installedAt: string;
}

export interface JournalEntry {
  op: 'install' | 'remove';
  target: TrustTargetId;
  startedAt: string;
  completedAt?: string;
}

export interface TrustManifest {
  version: 1;
  installId: string;
  caFingerprintSha256: string;
  caCertPem: string;
  entries: TrustEntry[];
  journal: JournalEntry[];
}

const JOURNAL_LIMIT = 50;

function manifestPath(): string {
  return path.join(getTlsDir(), 'trust.json');
}

export function readTrustManifest(): TrustManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) as TrustManifest;
    if (parsed?.version !== 1) return null;
    parsed.entries ??= [];
    parsed.journal ??= [];
    return parsed;
  } catch {
    return null;
  }
}

function writeTrustManifest(manifest: TrustManifest): void {
  fs.mkdirSync(getTlsDir(), { recursive: true, mode: 0o700 });
  const target = manifestPath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function loadOrInitManifest(init: {
  installId: string;
  caFingerprintSha256: string;
  caCertPem: string;
}): TrustManifest {
  const existing = readTrustManifest();
  // A CA fingerprint change means the identifying material was replaced; start
  // a fresh manifest so stale entries can't be mistaken for the new CA's.
  if (existing && existing.caFingerprintSha256 === init.caFingerprintSha256) {
    return existing;
  }
  return {
    version: 1,
    installId: init.installId,
    caFingerprintSha256: init.caFingerprintSha256,
    caCertPem: init.caCertPem,
    entries: [],
    journal: [],
  };
}

export function findEntry(m: TrustManifest, target: TrustTargetId): TrustEntry | undefined {
  return m.entries.find((e) => e.target === target);
}

/** Journal an intended mutation before it runs; returns the manifest for chaining. */
export function journalBegin(
  m: TrustManifest,
  op: 'install' | 'remove',
  target: TrustTargetId,
): TrustManifest {
  m.journal.push({ op, target, startedAt: new Date().toISOString() });
  if (m.journal.length > JOURNAL_LIMIT) m.journal.splice(0, m.journal.length - JOURNAL_LIMIT);
  writeTrustManifest(m);
  return m;
}

/** Mark the most recent matching journal entry complete. */
export function journalComplete(m: TrustManifest, op: 'install' | 'remove', target: TrustTargetId): void {
  for (let i = m.journal.length - 1; i >= 0; i -= 1) {
    const j = m.journal[i];
    if (j.op === op && j.target === target && !j.completedAt) {
      j.completedAt = new Date().toISOString();
      break;
    }
  }
  writeTrustManifest(m);
}

/** True if a mutation for this target was started but never completed. */
export function hasDanglingJournal(m: TrustManifest, target: TrustTargetId): boolean {
  return m.journal.some((j) => j.target === target && !j.completedAt);
}

export function upsertEntry(m: TrustManifest, entry: TrustEntry): void {
  const idx = m.entries.findIndex((e) => e.target === entry.target);
  if (idx >= 0) m.entries[idx] = entry;
  else m.entries.push(entry);
  writeTrustManifest(m);
}

export function removeEntryRecord(m: TrustManifest, target: TrustTargetId): void {
  m.entries = m.entries.filter((e) => e.target !== target);
  writeTrustManifest(m);
}
