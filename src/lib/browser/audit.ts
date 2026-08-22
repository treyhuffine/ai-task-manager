/**
 * Append-only audit trail for the agent browser.
 *
 * A browser acting in the user's logged-in accounts needs a record of what it
 * did. This is oversight, not restriction. Entries are durable (under `.config`,
 * not scratch) and secret-redacted. Surfaced through `browser_status` and,
 * later, the execution and transcript UI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '@/lib/config/paths';
import { redactSecrets } from './redact';

export interface AuditEntry {
  ts: string;
  action: string;
  session: string;
  url?: string;
  kind?: string;
  ref?: string;
  detail?: string;
  blocked?: string;
}

function auditDir(): string {
  const dir = path.join(getConfigDir(), 'browser', 'audit');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function auditPath(): string {
  return path.join(auditDir(), 'audit.jsonl');
}

/** Append one audit entry. Never throws into the caller. */
export function appendAudit(entry: Omit<AuditEntry, 'ts'>): void {
  try {
    const line: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
      url: entry.url,
      detail: entry.detail ? redactSecrets(entry.detail) : undefined,
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
