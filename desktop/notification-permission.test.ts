import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RemoteNotificationPermission } from './notification-permission';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('requires a local grant for the same Home and device, retained across app restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-notification-consent-')); roots.push(root);
  const file = path.join(root, 'permission.json'); const permission = new RemoteNotificationPermission(file, 'home', 'device');
  expect(permission.enabled()).toBe(false); permission.set(true);
  expect(new RemoteNotificationPermission(file, 'home', 'device').enabled()).toBe(true);
  expect(new RemoteNotificationPermission(file, 'other-home', 'device').enabled()).toBe(false);
  expect(new RemoteNotificationPermission(file, 'home', 'other-device').enabled()).toBe(false);
  expect(fs.statSync(file).mode & 0o077).toBe(0);
  permission.set(false); expect(permission.enabled()).toBe(false);
});
it('refuses unreadable, permissive or invalid local permission records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-notification-consent-')); roots.push(root);
  const file = path.join(root, 'permission.json'); const permission = new RemoteNotificationPermission(file, 'home', 'device');
  permission.set(true); fs.chmodSync(file, 0o644); expect(permission.enabled()).toBe(false);
  fs.chmodSync(file, 0o600); fs.writeFileSync(file, '{broken'); expect(permission.enabled()).toBe(false);
});
