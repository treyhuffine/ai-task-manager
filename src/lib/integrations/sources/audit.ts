/**
 * The managed-action audit trail (docs/connector-service-spec.md §11): which source, exact
 * account reference and action ran, at which tool version and schema, under which approval, when,
 * and how it ended. Append-only JSONL under the integrations dir. It never records argument
 * values or results (mail bodies stay out of logs): only argument names and a digest, so an
 * approved call can be matched to its record.
 *
 * An entry is written before dispatch with a local operation id, then again with the outcome and
 * Composio's log id. A dispatch with no outcome entry, or an `uncertain` one, is a write that may
 * have reached the provider, and the record is what investigating it starts from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inputDigest } from '@integrations/engine';
import { getIntegrationsDir } from '../storage';

export interface ManagedAuditEntry {
  ts: string;
  operationId: string;
  phase: 'dispatch' | 'outcome';
  sourceId: string;
  sourceKind: string;
  connectionId: string;
  remoteAccountId: string;
  actionId: string;
  slug: string;
  version?: string;
  schemaHash?: string;
  mutating: boolean;
  risk: string;
  /** How the call passed Ri's approval gate. */
  approval?: 'not_required' | 'standing' | 'granted' | 'dev_auto';
  caller?: string;
  argumentNames?: string[];
  argumentsDigest?: string;
  outcome?: 'ok' | 'failed' | 'uncertain' | 'refused';
  errorCode?: string;
  error?: string;
  logId?: string;
  durationMs?: number;
}

export function newOperationId(): string {
  return `op_${randomBytes(12).toString('hex')}`;
}

function auditFile(): string {
  const dir = path.join(/* turbopackIgnore: true */ getIntegrationsDir(), 'audit');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(/* turbopackIgnore: true */ dir, 'managed-actions.jsonl');
}

export function argumentSummary(args: unknown): { argumentNames: string[]; argumentsDigest: string } {
  const names = args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args).sort() : [];
  return { argumentNames: names, argumentsDigest: inputDigest(args ?? {}) };
}

/** Append one entry. Auditing never breaks a call: a write failure is reported to the console. */
export function recordManagedAction(entry: Omit<ManagedAuditEntry, 'ts'>, redact: (value: string) => string = value => value): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, ...(entry.error ? { error: redact(entry.error).slice(0, 500) } : {}) });
    fs.appendFileSync(auditFile(), `${line}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn('[integrations] managed action audit write failed', error instanceof Error ? error.message : error);
  }
}

/** Recent entries, newest last, for status views and investigation. */
export function readManagedAudit(limit = 200): ManagedAuditEntry[] {
  try {
    const lines = fs.readFileSync(/* turbopackIgnore: true */ auditFile(), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).flatMap(line => {
      try { return [JSON.parse(line) as ManagedAuditEntry]; } catch { return []; }
    });
  } catch {
    return [];
  }
}
