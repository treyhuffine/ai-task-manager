/**
 * The team AI's secrets (docs/homes-spec.md §9.9, P8.4), under
 * `<config>/team-ai`, never in the database and never sent to a client:
 *
 * - the model-provider key its owner provisioned for the team, sealed with a
 *   key of its own. Settings shows only whether one is saved.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { aesGcmSecretBox, generateSecretKey } from '@integrations/engine/crypto';
import { getConfigDir } from '@/lib/config/paths';

const STORE_VERSION = 1;

function dir(): string {
  return path.join(getConfigDir(), 'team-ai');
}

function harden(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
}

function ensureDir(): string {
  const d = dir();
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  harden(d, 0o700);
  return d;
}

/** A secret file made once and kept, 0600. */
function keptSecret(name: string, make: () => string): string {
  const file = path.join(dir(), name);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) {
      harden(file, 0o600);
      return existing;
    }
  } catch {
    // Made below.
  }
  ensureDir();
  try {
    fs.writeFileSync(file, make(), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    // Another process made it first: theirs is the one.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  harden(file, 0o600);
  return fs.readFileSync(file, 'utf8').trim();
}

function sealingKey(): string {
  return keptSecret('key', generateSecretKey);
}

interface StoredFile {
  version: typeof STORE_VERSION;
  sealedApiKey: string;
  setAt: string;
}

function credentialFile(): string {
  return path.join(dir(), 'credentials.json');
}

/** Keep the team's provider key. Replaces any earlier one. */
export async function saveTeamAiApiKey(apiKey: string): Promise<void> {
  const sealedApiKey = await aesGcmSecretBox({ key: sealingKey() }).seal({ apiKey });
  const d = ensureDir();
  const temporary = path.join(d, `credentials.${process.pid}.${Date.now()}.tmp`);
  const value: StoredFile = { version: STORE_VERSION, sealedApiKey, setAt: new Date().toISOString() };
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, credentialFile());
  harden(credentialFile(), 0o600);
}

/** The team's provider key, or null when it has none. Never a plaintext fallback. */
export async function readTeamAiApiKey(): Promise<string | null> {
  let stored: Partial<StoredFile>;
  try {
    stored = JSON.parse(fs.readFileSync(credentialFile(), 'utf8')) as Partial<StoredFile>;
  } catch {
    return null;
  }
  if (stored.version !== STORE_VERSION || typeof stored.sealedApiKey !== 'string') return null;
  try {
    const opened = await aesGcmSecretBox({ key: sealingKey() }).open<{ apiKey?: unknown }>(stored.sealedApiKey);
    return typeof opened?.apiKey === 'string' && opened.apiKey ? opened.apiKey : null;
  } catch {
    return null;
  }
}

export function hasTeamAiApiKey(): boolean {
  return fs.existsSync(credentialFile());
}

/** An opaque revision of the saved credential, never the provider secret. */
export function teamAiCredentialVersion(): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(credentialFile())).digest('hex');
  } catch {
    return null;
  }
}

export function forgetTeamAiApiKey(): void {
  fs.rmSync(credentialFile(), { force: true });
}
