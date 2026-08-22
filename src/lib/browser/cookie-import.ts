/**
 * macOS cookie import: copy a domain's cookies from the user's everyday Chrome
 * or Brave into the agent browser, so the agent is signed in without a manual
 * login. A nicety over the one-time `flow browser login` flow.
 *
 * Chromium on macOS encrypts cookie values with a key stored in the login
 * Keychain ("Chrome Safe Storage"). Reading it triggers a one-time Keychain
 * consent prompt. The decryption is the documented v10 scheme: PBKDF2 over the
 * Keychain secret, then AES-128-CBC.
 *
 * macOS only, and gated to trusted local callers by the action layer.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ActionError } from '@/lib/orchestrator/types';
import { getSession } from './runtime';
import { getHeadlessDefault } from './config';

export type CookieSource = 'chrome' | 'brave';

interface SourceSpec {
  cookiesPath: (profile: string) => string;
  keychainService: string;
}

const SOURCES: Record<CookieSource, SourceSpec> = {
  chrome: {
    cookiesPath: (p) => path.join(os.homedir(), 'Library/Application Support/Google/Chrome', p, 'Cookies'),
    keychainService: 'Chrome Safe Storage',
  },
  brave: {
    cookiesPath: (p) =>
      path.join(os.homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser', p, 'Cookies'),
    keychainService: 'Brave Safe Storage',
  },
};

interface CookieRow {
  host_key: string;
  name: string;
  encrypted_value: Buffer;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
}

function requireMac(): void {
  if (process.platform !== 'darwin') {
    throw new ActionError('unsupported', 'Cookie import is macOS only. Use `flow browser login` on other platforms.');
  }
}

/** The AES key derived from the browser's Keychain "Safe Storage" secret. */
function safeStorageKey(service: string): Buffer {
  let secret: string;
  try {
    secret = execFileSync('security', ['find-generic-password', '-w', '-s', service], {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new ActionError(
      'unsupported',
      `Could not read "${service}" from the login Keychain.`,
      'Approve the Keychain prompt and retry, or use `flow browser login`.',
    );
  }
  // Documented Chromium macOS scheme.
  return crypto.pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1');
}

function isPrintable(s: string): boolean {
  // Reject strings containing control characters (a wrong-key decrypt yields them).
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x00 && c <= 0x08) || (c >= 0x0e && c <= 0x1f)) return false;
  }
  return true;
}

/** Decrypt a Chromium v10/v11 cookie value. */
function decryptValue(encrypted: Buffer, key: Buffer): string {
  if (!encrypted || encrypted.length === 0) return '';
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') return encrypted.toString('utf8');

  const iv = Buffer.alloc(16, 0x20); // 16 spaces
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  let out = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);

  const pad = out[out.length - 1];
  if (pad > 0 && pad <= 16) out = out.subarray(0, out.length - pad);

  // Newer Chromium prepends a 32-byte SHA256(domain) before the value. Keep
  // whichever candidate is printable.
  const asIs = out.toString('utf8');
  if (out.length >= 32) {
    const stripped = out.subarray(32).toString('utf8');
    if (!isPrintable(asIs) && isPrintable(stripped)) return stripped;
  }
  return asIs;
}

function sameSite(v: number): 'Strict' | 'Lax' | 'None' | undefined {
  if (v === 0) return 'None';
  if (v === 1) return 'Lax';
  if (v === 2) return 'Strict';
  return undefined;
}

interface AddCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  expires?: number;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ImportResult {
  imported: number;
  domain: string;
  source: CookieSource;
}

export interface ImportOptions {
  domain: string;
  source?: CookieSource;
  chromeProfile?: string;
  /** The target agent profile to import into (default "agent"). */
  profile?: string;
}

export async function importCookies(opts: ImportOptions): Promise<ImportResult> {
  requireMac();
  const source = opts.source ?? 'chrome';
  const profile = opts.chromeProfile ?? 'Default';
  const spec = SOURCES[source];

  const dbPath = spec.cookiesPath(profile);
  if (!fs.existsSync(dbPath)) {
    throw new ActionError('not_found', `No ${source} cookies database for profile "${profile}" at ${dbPath}.`);
  }

  const key = safeStorageKey(spec.keychainService);

  // The live DB may be locked (WAL). Read a copy.
  const tmp = path.join(os.tmpdir(), `flow-cookies-${process.pid}-${Date.now()}.sqlite`);
  fs.copyFileSync(dbPath, tmp);
  let rows: CookieRow[];
  try {
    const db = new Database(tmp, { readonly: true });
    rows = db
      .prepare(
        'SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE host_key LIKE ?',
      )
      .all(`%${opts.domain}%`) as CookieRow[];
    db.close();
  } finally {
    try {
      fs.rmSync(tmp);
    } catch {
      // temp cleanup best-effort
    }
  }

  const nowSec = Date.now() / 1000;
  const cookies: AddCookie[] = [];
  for (const r of rows) {
    const value = decryptValue(r.encrypted_value, key);
    if (!value) continue;
    const secure = !!r.is_secure;
    const cookie: AddCookie = {
      name: r.name,
      value,
      domain: r.host_key,
      path: r.path || '/',
      httpOnly: !!r.is_httponly,
      secure,
    };
    if (r.expires_utc && r.expires_utc > 0) {
      const seconds = r.expires_utc / 1e6 - 11644473600;
      if (seconds > nowSec) cookie.expires = Math.floor(seconds);
    }
    const ss = sameSite(r.samesite);
    // A "None" cookie must be secure, or the browser rejects it.
    if (ss && !(ss === 'None' && !secure)) cookie.sameSite = ss;
    cookies.push(cookie);
  }

  if (cookies.length === 0) {
    throw new ActionError('not_found', `No cookies matched "${opts.domain}" in ${source} (profile "${profile}").`);
  }

  const session = await getSession({ profile: opts.profile, headless: getHeadlessDefault() });
  await session.agent.context.addCookies(cookies);
  return { imported: cookies.length, domain: opts.domain, source };
}
