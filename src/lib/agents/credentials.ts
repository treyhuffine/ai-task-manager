import fs from 'node:fs';
import path from 'node:path';
import { aesGcmSecretBox, generateSecretKey } from '@connectors/engine/crypto';
import { getConfigDir } from '@/lib/config/paths';

interface StoredCredentials {
  cursor?: {
    sealedApiKey: string;
    updatedAt: string;
  };
}

const STORE_VERSION = 1;

interface StoredFile {
  version: typeof STORE_VERSION;
  credentials: StoredCredentials;
}

function credentialsDir(): string {
  return path.join(getConfigDir(), 'agents');
}

function storePath(): string {
  return path.join(credentialsDir(), 'credentials.json');
}

function keyPath(): string {
  return path.join(credentialsDir(), 'key');
}

function hardenMode(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}

function ensureDir(): string {
  const dir = credentialsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  hardenMode(dir, 0o700);
  return dir;
}

function getOrCreateKey(): string {
  const file = keyPath();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) {
      hardenMode(file, 0o600);
      return existing;
    }
  } catch {
    // Create below.
  }

  ensureDir();
  const key = generateSecretKey();
  fs.writeFileSync(file, key, { mode: 0o600 });
  hardenMode(file, 0o600);
  return key;
}

function secretBox() {
  return aesGcmSecretBox({ key: getOrCreateKey() });
}

function readStore(): StoredFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Partial<StoredFile>;
    if (parsed.version === STORE_VERSION && parsed.credentials && typeof parsed.credentials === 'object') {
      return { version: STORE_VERSION, credentials: parsed.credentials };
    }
  } catch {
    // Missing or malformed stores are treated as empty. No plaintext fallback.
  }
  return { version: STORE_VERSION, credentials: {} };
}

function writeStore(value: StoredFile): void {
  const dir = ensureDir();
  const file = storePath();
  const temporary = path.join(dir, `credentials.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
  hardenMode(file, 0o600);
}

export interface CursorCredentialStatus {
  configured: boolean;
  source: 'flow_store' | 'environment' | 'none';
  updatedAt: string | null;
}

export function cursorCredentialStatus(): CursorCredentialStatus {
  const cursor = readStore().credentials.cursor;
  if (cursor) return { configured: true, source: 'flow_store', updatedAt: cursor.updatedAt };
  if (process.env.CURSOR_API_KEY) return { configured: true, source: 'environment', updatedAt: null };
  return { configured: false, source: 'none', updatedAt: null };
}

export async function setCursorApiKey(apiKey: string): Promise<CursorCredentialStatus> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('Cursor API key must not be empty');
  const store = readStore();
  store.credentials.cursor = {
    sealedApiKey: await secretBox().seal({ apiKey: trimmed }),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return cursorCredentialStatus();
}

export function clearCursorApiKey(): CursorCredentialStatus {
  const store = readStore();
  delete store.credentials.cursor;
  writeStore(store);
  return cursorCredentialStatus();
}

/** Open only at the process boundary. Never return this value from an API. */
export async function openCursorApiKey(): Promise<string | null> {
  const stored = readStore().credentials.cursor;
  if (!stored) return process.env.CURSOR_API_KEY ?? null;
  const opened = await secretBox().open<{ apiKey?: unknown }>(stored.sealedApiKey);
  return typeof opened.apiKey === 'string' && opened.apiKey ? opened.apiKey : null;
}
