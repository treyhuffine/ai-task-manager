/**
 * VAPID keypair for web push (spec §2.11). Generated once and stored in `.config/notifications`
 * (precious, never synced, mode 0600 — mirrors the connectors at-rest key). The PUBLIC key is
 * handed to the browser to subscribe; the PRIVATE key signs pushes server-side and never leaves.
 * Server-only (fs + the `web-push` lib).
 */
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { getConfigDir } from '@/lib/config/paths';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cached: VapidKeys | null = null;

/** VAPID `sub` claim — a mailto:/https contact. Overridable; the value itself is not sensitive. */
export const VAPID_SUBJECT = process.env.NOTIFIER_VAPID_SUBJECT ?? 'mailto:notifier@localhost';

function hardenMode(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* best-effort: some filesystems reject chmod */
  }
}

/** Read or lazily create the VAPID keypair. Re-hardens perms on every read (restored files). */
export function getVapidKeys(): VapidKeys {
  if (cached) return cached;
  const dir = path.join(getConfigDir(), 'notifications');
  const file = path.join(dir, 'vapid.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as VapidKeys;
    if (parsed.publicKey && parsed.privateKey) {
      hardenMode(dir, 0o700);
      hardenMode(file, 0o600);
      cached = parsed;
      return parsed;
    }
  } catch {
    /* fall through to create */
  }
  const generated = webpush.generateVAPIDKeys();
  const value: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  hardenMode(dir, 0o700);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  hardenMode(file, 0o600);
  cached = value;
  return value;
}

/** Configure the `web-push` lib with our VAPID details (call before sendNotification). */
export function configureWebPush(): void {
  const { publicKey, privateKey } = getVapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
}
