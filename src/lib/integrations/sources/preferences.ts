/**
 * `<config-dir>/integrations/preferences.json`: the home's managed sources and connection-method
 * preferences (docs/connector-service-spec.md §6). Safe metadata only. Credentials live in the
 * sealed source credential store (./source-credentials.ts), account references in the connection
 * store.
 *
 * A missing file means no saved preferences, which keeps today's direct behavior. A malformed file
 * or an unsupported version is reported and left untouched: managed sources stay unavailable
 * until it is repaired, and nothing is reset or widened to recover. Every write is atomic and
 * serialized with the cross-process file lock, and reads the current revision under that lock
 * before applying a partial change.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getIntegrationsDir } from '../storage';
import { APPLICATION_IDS, EMPTY_PREFERENCES, SOURCE_KINDS, type SourcePreferences } from './types';
import { SOURCE_ID_PATTERN } from './applications';

export const PREFERENCES_FILE = 'preferences.json';

const managedMethod = z.object({ sourceId: z.string().regex(SOURCE_ID_PATTERN) }).strict();
const directMethod = z.object({
  kind: z.literal('direct'), providerId: z.string().min(1).max(64), authConfigId: z.string().min(1).max(200).optional(),
}).strict();

const sourceEntry = z.object({
  id: z.string().regex(SOURCE_ID_PATTERN),
  kind: z.enum(SOURCE_KINDS),
  label: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
  remoteUserId: z.string().regex(/^ri-[a-z0-9]{20,64}$/),
  createdAt: z.string().min(1),
  project: z.object({ id: z.string().min(1).max(200), name: z.string().max(200).optional() }).strict().optional(),
  authConfigs: z.record(z.string().min(1).max(100), z.string().min(1).max(200)).optional(),
}).strict();

export const preferencesSchema = z.object({
  version: z.literal(1),
  sources: z.array(sourceEntry).max(20),
  preferredSourceId: z.string().regex(SOURCE_ID_PATTERN).optional(),
  // A method validates as exactly one shape: `kind` with `sourceId` matches neither.
  applicationMethods: z.partialRecord(z.enum(APPLICATION_IDS), z.union([managedMethod, directMethod])),
  retiredSourceIds: z.array(z.string().regex(SOURCE_ID_PATTERN)).max(500),
  calendarUse: z.record(z.string().min(1).max(300), z.boolean()),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (ids.has(source.id)) ctx.addIssue({ code: 'custom', message: `Duplicate source id ${source.id}.` });
    if (value.retiredSourceIds.includes(source.id)) ctx.addIssue({ code: 'custom', message: `Source id ${source.id} was retired.` });
    ids.add(source.id);
  }
  const users = new Set<string>();
  for (const source of value.sources) {
    if (users.has(source.remoteUserId)) ctx.addIssue({ code: 'custom', message: 'Two sources share one remote user.' });
    users.add(source.remoteUserId);
  }
});

export type PreferencesRead =
  | { status: 'missing'; preferences: SourcePreferences }
  | { status: 'ok'; preferences: SourcePreferences }
  /** Present but unusable. `preferences` is the empty set, so direct behavior is unaffected. */
  | { status: 'invalid'; preferences: SourcePreferences; error: string; file: string }
  | { status: 'unsupported'; preferences: SourcePreferences; version: unknown; file: string };

export class PreferencesUnavailableError extends Error {
  constructor(readonly read: Extract<PreferencesRead, { status: 'invalid' | 'unsupported' }>) {
    super(read.status === 'unsupported'
      ? `${read.file} uses version ${String(read.version)}, which this version of Ri can't read. It was left unchanged.`
      : `${read.file} can't be read (${read.error}). It was left unchanged. Repair or move it, then try again.`);
    this.name = 'PreferencesUnavailableError';
  }
}

export function preferencesPath(dir = getIntegrationsDir()): string {
  return path.join(dir, PREFERENCES_FILE);
}

function parse(text: string, file: string): PreferencesRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { status: 'invalid', preferences: structuredClone(EMPTY_PREFERENCES), error: `not JSON: ${(error as Error).message}`, file };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { version?: unknown }).version !== 1) {
    return { status: 'unsupported', preferences: structuredClone(EMPTY_PREFERENCES), version: (raw as { version?: unknown }).version, file };
  }
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { status: 'invalid', preferences: structuredClone(EMPTY_PREFERENCES), error: `${where}${issue?.message ?? 'invalid'}`, file };
  }
  return { status: 'ok', preferences: parsed.data as SourcePreferences };
}

/** Read the current preferences. Never throws for file content, and never writes. */
export function readPreferences(dir = getIntegrationsDir()): PreferencesRead {
  const file = preferencesPath(dir);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', preferences: structuredClone(EMPTY_PREFERENCES) };
    return { status: 'invalid', preferences: structuredClone(EMPTY_PREFERENCES), error: (error as Error).message, file };
  }
  return parse(text, file);
}

/** The preferences, or the empty set when the file is missing or unusable (direct behavior). */
export function currentPreferences(dir = getIntegrationsDir()): SourcePreferences {
  return readPreferences(dir).preferences;
}

/**
 * Apply a change under the cross-process lock. The mutator receives a copy of the revision on
 * disk at that moment and returns the next one (or mutates its argument). The result is validated
 * before it is written. An unusable file is never overwritten.
 */
export function updatePreferences<T = void>(
  mutate: (preferences: SourcePreferences) => T,
  dir = getIntegrationsDir(),
): { preferences: SourcePreferences; result: T } {
  const file = preferencesPath(dir);
  return withFileLock(file, () => {
    const current = readPreferences(dir);
    if (current.status === 'invalid' || current.status === 'unsupported') throw new PreferencesUnavailableError(current);
    const next = structuredClone(current.preferences);
    const result = mutate(next);
    const checked = preferencesSchema.safeParse(next);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new Error(`That change would leave the connection preferences invalid${issue ? ` (${issue.path.join('.') || 'root'}: ${issue.message})` : ''}.`);
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWriteFile(file, `${JSON.stringify(checked.data, null, 2)}\n`);
    return { preferences: checked.data as SourcePreferences, result };
  });
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: number, length: number): string {
  const buffer = randomBytes(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) out += BASE32[buffer[i % buffer.length]! % 32];
  return out;
}

/** A fresh source id that no current or retired source has used. */
export function newSourceId(preferences: SourcePreferences): string {
  const taken = new Set([...preferences.sources.map(source => source.id), ...preferences.retiredSourceIds]);
  for (;;) {
    const id = `cmp${base32(8, 4)}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * The external user id for one source instance. Random, never derived from an email or the local
 * owner sentinel ('local' is not globally unique), and never chosen by a model.
 */
export function newRemoteUserId(): string {
  return `ri-${randomBytes(16).toString('hex')}`;
}
