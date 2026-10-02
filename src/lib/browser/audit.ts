/**
 * Append-only audit trail for the agent browser.
 *
 * A browser acting in the user's logged-in accounts needs a record of what it
 * did. This is oversight, not restriction. Entries are durable (under `.config`,
 * not scratch) and secret-redacted. Surfaced through `browser_status` and,
 * later, the execution and transcript UI.
 *
 * An `evaluate` records the whole script. It goes to a content-addressed file
 * beside the log (`scripts/<sha256>.js`, so a script run a hundred times is
 * stored once), and the entry carries its hash, size and a short preview, which
 * keeps `browser_status` readable.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '@/lib/config/paths';
import { redactSecrets } from './redact';

export interface AuditScript {
  sha256: string;
  chars: number;
  /** The full script, under the audit dir. */
  path: string;
  preview: string;
}

export interface AuditEntry {
  ts: string;
  action: string;
  /** The browser profile. */
  session: string;
  /** The chat whose agent called, when the transport knew it. */
  chat?: string;
  url?: string;
  kind?: string;
  ref?: string;
  detail?: string;
  blocked?: string;
  /** evaluate: the tab's origin when the script started. */
  origin?: string;
  /** evaluate: the script that ran. */
  script?: AuditScript;
  /** evaluate: size of the value it returned, as JSON. */
  resultChars?: number;
  /** Placeholders filled (names only) and requests refused, for an evaluate. */
  requests?: unknown;
  error?: string;
}

function auditDir(): string {
  const dir = path.join(getConfigDir(), 'browser', 'audit');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function auditPath(): string {
  return path.join(auditDir(), 'audit.jsonl');
}

const PREVIEW_CHARS = 240;

/**
 * Store a script for the audit trail and describe it. The stored copy is
 * redacted like everything else here. Cookie values never appear in a script
 * (the agent writes `{{cookie:<name>}}` placeholders, filled at the network
 * layer), so what's stored is exactly what the agent wrote, minus known
 * credential formats.
 */
export function storeScript(fn: string): AuditScript {
  const text = redactSecrets(fn);
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  const dir = path.join(auditDir(), 'scripts');
  const file = path.join(dir, `${sha256}.js`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(file)) fs.writeFileSync(file, text, { mode: 0o600 });
  } catch {
    // Auditing must never break a run.
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  return {
    sha256,
    chars: text.length,
    path: file,
    preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat,
  };
}

/** Append one audit entry. Never throws into the caller. */
export function appendAudit(entry: Omit<AuditEntry, 'ts'>): void {
  try {
    const line: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
      url: entry.url,
      detail: entry.detail ? redactSecrets(entry.detail) : undefined,
      error: entry.error ? redactSecrets(entry.error) : undefined,
    };
    fs.appendFileSync(auditPath(), JSON.stringify(line) + '\n', { mode: 0o600 });
  } catch {
    // Auditing must never break a run.
  }
}

/** The most recent audit entries, newest last. */
export function readAuditTail(limit = 20): AuditEntry[] {
  try {
    const raw = fs.readFileSync(auditPath(), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null);
  } catch {
    return [];
  }
}
