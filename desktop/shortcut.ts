import fs from 'node:fs';
import { atomicWriteFile } from '../src/lib/config/atomic-write';
import { DEFAULT_CAPTURE_SHORTCUT, type CaptureShortcutPreference, type CaptureShortcutStatus } from '../src/lib/client/desktop-settings';

type ShortcutApi = { register(accelerator: string, callback: () => void): boolean; unregister(accelerator: string): void; isRegistered(accelerator: string): boolean };
const aliases: Record<string, string> = { cmdorctrl: 'CommandOrControl', commandorcontrol: 'CommandOrControl', command: 'Command', cmd: 'Command', control: 'Control', ctrl: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift' };

/** Restrict this one action to intentional modified keys, never bare typing. */
export function captureAccelerator(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80) throw new Error('Enter a shortcut such as CommandOrControl+Shift+K.');
  const parts = value.split('+').map(part => part.trim());
  const key = parts.pop() ?? '';
  const modifiers = parts.map(part => aliases[part.toLowerCase()]);
  if (modifiers.some(part => !part) || new Set(modifiers).size !== modifiers.length ||
      modifiers.filter(part => ['CommandOrControl', 'Command', 'Control'].includes(part)).length !== 1 ||
      !/^(?:[a-z0-9]|F(?:[1-9]|1\d|2[0-4])|Space)$/i.test(key)) {
    throw new Error('Use CommandOrControl, Command or Control, optional Shift/Alt, and a letter, number, F-key or Space.');
  }
  const ordered = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Shift'].filter(part => modifiers.includes(part));
  return [...ordered, key.toLowerCase() === 'space' ? 'Space' : key.toUpperCase()].join('+');
}

export class CaptureShortcut {
  private preference: CaptureShortcutPreference = { enabled: false, accelerator: DEFAULT_CAPTURE_SHORTCUT };
  private registered?: string;
  private failure?: string;
  constructor(private file: string, private api: ShortcutApi, private capture: () => void, private wayland = false, private prepare?: () => void) {}
  start() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof data.enabled !== 'boolean') throw new Error('Invalid shortcut preference');
      this.preference = { enabled: data.enabled, accelerator: captureAccelerator(data.accelerator) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.failure = 'The saved shortcut could not be read. Choose a shortcut to repair it.';
    }
    if (this.preference.enabled) {
      try { this.claim(this.preference.accelerator); } catch (error) { this.failure = (error as Error).message; }
    }
    return this.status();
  }
  private claim(accelerator: string) {
    if (this.registered === accelerator && this.api.isRegistered(accelerator)) return;
    this.prepare?.();
    if (!this.api.register(accelerator, this.capture)) throw new Error('This shortcut could not be registered. It may be used by another app or need desktop permission. Choose another shortcut or retry.');
  }
  configure(value: CaptureShortcutPreference) {
    if (typeof value.enabled !== 'boolean') throw new Error('Choose whether to enable the shortcut.');
    const next = { enabled: value.enabled, accelerator: captureAccelerator(value.accelerator) };
    const previous = this.registered;
    if (next.enabled) this.claim(next.accelerator);
    try { atomicWriteFile(this.file, JSON.stringify(next)); }
    catch (error) {
      if (next.enabled && next.accelerator !== previous) this.api.unregister(next.accelerator);
      throw error;
    }
    if (previous && (!next.enabled || previous !== next.accelerator)) this.api.unregister(previous);
    this.registered = next.enabled ? next.accelerator : undefined;
    this.preference = next; this.failure = undefined;
    return this.status();
  }
  status(): CaptureShortcutStatus {
    const active = this.preference.enabled && this.api.isRegistered(this.preference.accelerator);
    if (active) this.registered = this.preference.accelerator;
    return { ...this.preference, state: active ? 'active' : this.preference.enabled || this.failure ? 'unavailable' : 'off',
      detail: this.failure ?? (this.preference.enabled && !active ? 'The shortcut is unavailable. Choose another shortcut or retry.' : active && this.wayland ? 'Shortcut requested through your desktop. Confirm its shortcut permission if prompted.' : undefined) };
  }
  stop() { if (this.registered) this.api.unregister(this.registered); this.registered = undefined; }
}
