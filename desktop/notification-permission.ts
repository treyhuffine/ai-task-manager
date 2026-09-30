import fs from 'node:fs';
import { atomicWriteFile } from '../src/lib/config/atomic-write';

/** Server-side channel preferences never grant OS presentation permission.
 * This decision is made in the trusted local companion and bound to its Home
 * and device, so reconnecting or signing into another Home cannot inherit it. */
export class RemoteNotificationPermission {
  constructor(private file: string, private homeId: string, private deviceId: string) {}
  enabled(): boolean {
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) return false;
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return value.format === 1 && value.homeId === this.homeId && value.deviceId === this.deviceId && value.enabled === true;
    } catch { return false; }
  }
  set(enabled: boolean) {
    atomicWriteFile(this.file, JSON.stringify({ format: 1, homeId: this.homeId, deviceId: this.deviceId, enabled }));
  }
}
