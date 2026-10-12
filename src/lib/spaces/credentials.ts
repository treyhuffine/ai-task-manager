/**
 * The keys a personal home signs in to its teams with (docs/homes-spec.md
 * §9.3, P7.1). One member key per team, sealed with a key of its own under
 * `<config>/teams`, never in the database, never sent to a client. The team
 * holds only the key's hash, and gets no credential for this home.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { aesGcmSecretBox, generateSecretKey } from '@integrations/engine/crypto';
import { getConfigDir } from '@/lib/config/paths';

const STORE_VERSION = 1;

interface SealedTeamKey {
  sealedToken: string;
  memberId: string;
  updatedAt: string;
}

interface StoredFile {
  version: typeof STORE_VERSION;
  teams: Record<string, SealedTeamKey>;
}

function storeDir(): string {
  return path.join(getConfigDir(), 'teams');
}

function hardenMode(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Best effort on filesystems without POSIX modes.
  }
}

function ensureDir(): string {
  const dir = storeDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  hardenMode(dir, 0o700);
  return dir;
}

function getOrCreateKey(): string {
  const file = path.join(storeDir(), 'key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) {
      hardenMode(file, 0o600);
      return existing;
    }
  } catch {
    // Made below.
  }
  ensureDir();
  const key = generateSecretKey();
  fs.writeFileSync(file, key, { mode: 0o600 });
  hardenMode(file, 0o600);
  return key;
}

/** Stable across restarts, bound to this home and this exact link, never the home key itself. */
export function teamConnectAttempt(origin: string, kind: string, secret: string): string {
  return createHmac('sha256', getOrCreateKey()).update(JSON.stringify(['team-connect-v1', origin, kind, secret])).digest('hex');
}

function readStore(): StoredFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(storeDir(), 'credentials.json'), 'utf8')) as Partial<StoredFile>;
    if (parsed.version === STORE_VERSION && parsed.teams && typeof parsed.teams === 'object') {
      return { version: STORE_VERSION, teams: parsed.teams };
    }
  } catch {
    // A missing or unreadable store holds no keys. Never a plaintext fallback.
  }
  return { version: STORE_VERSION, teams: {} };
}

function writeStore(value: StoredFile): void {
  const dir = ensureDir();
  const file = path.join(dir, 'credentials.json');
  const temporary = path.join(dir, `credentials.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
  hardenMode(file, 0o600);
}

/** Keep the member key this home signs in to `teamId` with. */
export async function saveTeamKey(
  teamId: string, memberId: string, token: string,
  commit?: { assertCurrent: () => void; onSaved: () => void },
): Promise<void> {
  const sealedToken = await aesGcmSecretBox({ key: getOrCreateKey() }).seal({ token });
  // Sealing yields. Recheck the caller's connection before the synchronous
  // store write so a disconnect or newer sign-in cannot be overwritten.
  commit?.assertCurrent();
  const store = readStore();
  store.teams[teamId] = { sealedToken, memberId, updatedAt: new Date().toISOString() };
  writeStore(store);
  // Publish the matching database identity before yielding to another writer.
  commit?.onSaved();
}

/** The key for `teamId`, or null when this home has none for it. */
export function teamKeyVersion(teamId: string): string | null {
  return readStore().teams[teamId]?.sealedToken ?? null;
}

export async function readTeamKey(teamId: string): Promise<{ token: string; memberId: string; version: string } | null> {
  const entry = readStore().teams[teamId];
  if (!entry) return null;
  try {
    const opened = await aesGcmSecretBox({ key: getOrCreateKey() }).open<{ token?: unknown }>(entry.sealedToken);
    return typeof opened?.token === 'string' ? { token: opened.token, memberId: entry.memberId, version: entry.sealedToken } : null;
  } catch {
    return null;
  }
}

export function forgetTeamKey(teamId: string): void {
  const store = readStore();
  if (!(teamId in store.teams)) return;
  delete store.teams[teamId];
  writeStore(store);
}
