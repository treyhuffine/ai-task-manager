import { z } from 'zod/v4';
import type { AccessScope } from '@ri/app-kit/data';
import { calendarCoverage, mailCoverage, type CalendarCheckpoint, type MailCheckpoint } from '@ri/app-kit/sources';
import type { Ctx } from './context.js';
import { canSee, sourceFilter } from './scope.js';
import type { Coverage } from '../schemas.js';

/** Human labels for source keys, loaded once per request. */
export class Labels {
  private readonly map = new Map<string, string>();
  constructor(ctx: Ctx) {
    for (const account of ctx.accounts.list()) {
      const key = `account:${account.account}`;
      if (!this.map.has(key) || account.kind === 'mail') this.map.set(key, account.label ?? (account.kind === 'mail' ? 'Gmail account' : 'Google Calendar'));
    }
    for (const row of ctx.db.all<{ source_key: string; label: string }>('SELECT source_key, label FROM collections')) this.map.set(row.source_key, row.label);
    for (const row of ctx.db.all<{ source_key: string; label: string }>('SELECT source_key, label FROM imports ORDER BY created_at DESC LIMIT 500')) this.map.set(row.source_key, row.label);
  }
  of(key: string | null | undefined): string {
    if (!key) return 'Unknown source';
    return this.map.get(key) ?? (key.startsWith('account:') ? 'Disconnected account' : key.startsWith('import:') ? 'Removed import' : 'Your records');
  }
}

export const extractionSettingSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(['off', 'on', 'paused', 'unavailable']),
  reason: z.string().max(300).nullable(),
  updatedAt: z.string().nullable(),
}).strict();
export type ExtractionSetting = z.infer<typeof extractionSettingSchema>;
export const EXTRACTION_OFF: ExtractionSetting = { enabled: false, status: 'off', reason: null, updatedAt: null };
export function extractionSetting(ctx: Ctx): ExtractionSetting {
  return ctx.settings.get('extraction', extractionSettingSchema, EXTRACTION_OFF);
}

const calendarMap = z.record(z.string(), z.unknown());

/**
 * What was checked for this caller: accounts and ranges it may see, pending
 * extraction and held failures. Partial whenever anything is incomplete, so an
 * empty result is never presented as an all-clear.
 */
export function coverageFor(ctx: Ctx, scope: AccessScope, granted?: ReadonlySet<string> | null): Coverage {
  const labels = new Labels(ctx);
  const accounts: Coverage['accounts'] = [];
  for (const account of ctx.accounts.list()) {
    const source = `account:${account.account}`;
    if (!canSee(scope, source)) continue;
    let range: { from: string | null; to: string | null; partial: boolean; lastSuccessAt: string | null };
    if (account.kind === 'mail') range = mailCoverage((account.checkpoint as MailCheckpoint | null) ?? null);
    else {
      const map = calendarMap.safeParse(account.checkpoint).success ? (account.checkpoint as Record<string, CalendarCheckpoint>) : {};
      const parts = Object.values(map).map((checkpoint) => calendarCoverage(checkpoint));
      range = parts.length
        ? { from: parts.map((part) => part.from).filter(Boolean).sort()[0] ?? null, to: parts.map((part) => part.to).filter(Boolean).sort().at(-1) ?? null, partial: parts.some((part) => part.partial), lastSuccessAt: parts.map((part) => part.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null }
        : { from: null, to: null, partial: true, lastSuccessAt: null };
    }
    const disconnected = granted ? !granted.has(account.account) : false;
    accounts.push({
      source,
      label: labels.of(source),
      kind: account.kind,
      from: range.from,
      to: range.to,
      partial: range.partial || account.status !== 'ready',
      status: disconnected ? 'disconnected' : account.status,
      lastSuccessAt: account.lastSuccessAt ?? range.lastSuccessAt,
    });
  }
  const extraction = extractionSetting(ctx);
  const filter = sourceFilter(scope, 'source_key');
  const pending = extraction.enabled
    ? Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM work_items WHERE kind = 'extract' AND state = 'pending' AND ${filter.sql}`, ...filter.params)?.count ?? 0)
    : 0;
  const failed = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM work_items WHERE state = 'failed' AND kind = 'extract' AND ${filter.sql}`, ...filter.params)?.count ?? 0)
    + accounts.filter((account) => account.status === 'error' || account.status === 'reconnect').length;
  const importFilter = sourceFilter(scope, 'source_key');
  const imports = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM imports WHERE ${importFilter.sql}`, ...importFilter.params)?.count ?? 0);
  const partial = accounts.some((account) => account.partial || account.status === 'disconnected') || pending > 0 || failed > 0;
  const day = (value: string | null) => (value ? value.slice(0, 10) : 'unknown');
  const parts = accounts.map((account) => `${account.label} (${account.kind}${account.from ? `, ${day(account.from)} to ${day(account.to)}` : ', not yet checked'}${account.partial ? ', partial' : ''}${account.status === 'disconnected' ? ', disconnected' : ''})`);
  const summary = [
    parts.length ? `Checked ${parts.join(' and ')}.` : 'No connected account is included.',
    imports ? `${imports} imported file${imports === 1 ? '' : 's'}.` : '',
    extraction.status === 'on' ? (pending ? `${pending} item${pending === 1 ? '' : 's'} waiting for extraction.` : 'Extraction is up to date.') : extraction.status === 'unavailable' ? 'Extraction unavailable.' : 'Relationship extraction is off.',
    failed ? `${failed} held failure${failed === 1 ? '' : 's'}.` : '',
  ].filter(Boolean).join(' ').slice(0, 500);
  return { accounts, imports, partial, pendingExtraction: pending, failed, extraction: extraction.status, summary };
}
