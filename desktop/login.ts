import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App, LoginItemSettings } from 'electron';

export interface DesktopLoginStatus {
  supported: boolean;
  enabled: boolean;
  state: 'enabled' | 'disabled' | 'requires-approval' | 'unavailable' | 'conflict' | 'moved' | 'error';
  detail?: string;
}

type LoginApp = Pick<App, 'isPackaged' | 'setLoginItemSettings'> & {
  getLoginItemSettings: (options?: { type: 'mainAppService' }) => Pick<LoginItemSettings, 'openAtLogin' | 'status' | 'wasOpenedAtLogin'>;
};

export interface DesktopLoginOptions {
  app: LoginApp;
  platform?: NodeJS.Platform;
  executable?: string;
  /** AppImage's mounted executable disappears on exit. Register the image itself. */
  appImage?: string;
  home?: string;
  configHome?: string;
}

const ENTRY_NAME = 'app.ri.desktop.autostart.desktop';
const MARKER = '# Ri desktop login item v1: ';
const MAC_LIMITATION = 'On macOS, login items need a packaged, signed, and notarized app to work reliably.';
const conflict = (): DesktopLoginStatus => ({ supported: true, enabled: false, state: 'conflict', detail: 'The existing login item belongs to another installation or was edited outside Ri. It was left unchanged.' });

/** Desktop-entry quoting is not shell quoting. Apply Exec quoting first and
 * the general string escaping second. Percent signs are literal field codes.
 * https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html */
export function loginExecArgument(value: string) {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('The application path contains a control character. Move Ri to a different folder.');
  return `"${value.replaceAll('%', '%%').replace(/["`$\\]/g, '\\$&').replaceAll('\\', '\\\\')}"`;
}

function entry(executable: string, enabled: boolean) {
  return [
    '[Desktop Entry]',
    `${MARKER}${JSON.stringify({ executable })}`,
    'Type=Application',
    'Name=Ri',
    'Comment=Keep Ri notifications and Quick Capture available',
    `Exec=${loginExecArgument(executable)} --ri-background --ri-use-saved-installation`,
    'Terminal=false',
    `Hidden=${!enabled}`,
    `X-GNOME-Autostart-enabled=${enabled}`,
    '',
  ].join('\n');
}

function ownedEntry(contents: string): { executable: string; enabled: boolean } | undefined {
  try {
    const marker = contents.split('\n').find(line => line.startsWith(MARKER));
    if (!marker) return;
    const data = JSON.parse(marker.slice(MARKER.length)) as { executable?: unknown };
    if (typeof data.executable !== 'string' || !path.isAbsolute(data.executable)) return;
    // Desktop startup settings commonly change just one of these flags. Respect
    // either opt-out without treating an otherwise unmodified entry as foreign.
    for (const hidden of [true, false]) for (const gnomeEnabled of [true, false]) {
      const expected = entry(data.executable, true).replace('Hidden=false', `Hidden=${hidden}`).replace('X-GNOME-Autostart-enabled=true', `X-GNOME-Autostart-enabled=${gnomeEnabled}`);
      if (contents === expected) return { executable: data.executable, enabled: !hidden && gnomeEnabled };
    }
  } catch { /* A malformed or hand-edited file is not ours to replace. */ }
}

function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function executableExists(executable: string) {
  try { return fs.statSync(executable).isFile(); } catch (error) { if (missing(error)) return false; throw error; }
}
function sameExecutable(left: string, right: string) {
  if (left === right) return true;
  try { return fs.realpathSync(left) === fs.realpathSync(right); } catch { return false; }
}

/** Only explicit settings changes mutate the OS. Reading status never restores a
 * preference the user disabled in System Settings or their desktop session. */
export function createDesktopLogin(options: DesktopLoginOptions) {
  const platform = options.platform ?? process.platform;
  const executable = options.executable ?? process.execPath;
  const appImage = options.appImage ?? process.env.APPIMAGE;
  const launchPath = platform === 'linux' && appImage ? appImage : executable;
  const home = options.home ?? os.homedir();
  const requestedConfig = options.configHome ?? process.env.XDG_CONFIG_HOME;
  const config = requestedConfig && path.isAbsolute(requestedConfig) ? requestedConfig : path.join(home, '.config');
  const file = path.join(config, 'autostart', ENTRY_NAME);

  function unavailable(): DesktopLoginStatus | undefined {
    if (!options.app.isPackaged) return { supported: false, enabled: false, state: 'unavailable', detail: 'Install a packaged Ri application to launch the desktop at login.' };
    if (platform !== 'darwin' && platform !== 'linux') return { supported: false, enabled: false, state: 'unavailable', detail: 'Desktop launch at login is available on macOS and Linux.' };
    if (platform === 'linux' && (!path.isAbsolute(launchPath) || launchPath.includes('=') || /[\u0000-\u001f\u007f]/.test(launchPath))) {
      return { supported: false, enabled: false, state: 'unavailable', detail: 'Ri needs an absolute application path without control characters or an equals sign to launch at login.' };
    }
    if (platform === 'linux' && !appImage && /(?:^|\/)\.mount_[^/]+(?:\/|$)/.test(launchPath)) {
      return { supported: false, enabled: false, state: 'unavailable', detail: 'The original AppImage location could not be found. Launch Ri from its saved AppImage, then try again.' };
    }
  }

  function linuxEntry(): { contents: string; executable: string; enabled: boolean } | undefined | 'foreign' {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return 'foreign';
      const contents = fs.readFileSync(file, 'utf8');
      const owner = ownedEntry(contents);
      return owner ? { contents, ...owner } : 'foreign';
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }

  function status(): DesktopLoginStatus {
    const unsupported = unavailable();
    if (unsupported) return unsupported;
    try {
      if (platform === 'darwin') {
        const settings = options.app.getLoginItemSettings({ type: 'mainAppService' });
        if (settings.status === 'requires-approval') return { supported: true, enabled: false, state: 'requires-approval', detail: 'Allow Ri in System Settings > General > Login Items & Extensions.' };
        if (settings.status === 'enabled' && settings.openAtLogin) return { supported: true, enabled: true, state: 'enabled' };
        if (settings.status === 'not-found') return { supported: true, enabled: false, state: 'unavailable', detail: `macOS could not locate this application as a login item. ${MAC_LIMITATION}` };
        return { supported: true, enabled: false, state: 'disabled', detail: MAC_LIMITATION };
      }
      const current = linuxEntry();
      if (current === 'foreign') return conflict();
      if (!current) return { supported: true, enabled: false, state: 'disabled' };
      if (!sameExecutable(current.executable, launchPath)) {
        if (executableExists(current.executable)) return conflict();
        return { supported: true, enabled: false, state: 'moved', detail: 'The registered application was moved or removed. Enable launch at login again to use this copy of Ri.' };
      }
      if (current.enabled && !executableExists(launchPath)) return { supported: true, enabled: false, state: 'moved', detail: 'The registered application no longer exists. Launch Ri from its installed location, then enable launch at login again.' };
      if (current.enabled) fs.accessSync(launchPath, fs.constants.X_OK);
      return { supported: true, enabled: current.enabled, state: current.enabled ? 'enabled' : 'disabled' };
    } catch (error) { return failure(error); }
  }

  function failure(error: unknown): DesktopLoginStatus {
    return { supported: true, enabled: false, state: 'error', detail: `Could not change or read desktop launch at login. ${error instanceof Error ? error.message : 'Please try again.'}` };
  }

  function setEnabled(enabled: boolean): DesktopLoginStatus {
    const unsupported = unavailable();
    if (unsupported) return unsupported;
    try {
      if (typeof enabled !== 'boolean') throw new Error('Choose whether to launch Ri at login.');
      if (platform === 'darwin') {
        options.app.setLoginItemSettings({ openAtLogin: enabled, type: 'mainAppService' });
        const result = status();
        if (enabled && result.state === 'disabled') return { ...result, state: 'error', detail: `macOS did not enable Ri at login. ${MAC_LIMITATION}` };
        if (!enabled && (result.enabled || result.state === 'requires-approval')) return { ...result, state: 'error', detail: 'macOS did not remove Ri from login items. Check System Settings > General > Login Items & Extensions.' };
        return result;
      }
      const current = linuxEntry();
      if (current === 'foreign' || (current && !sameExecutable(current.executable, launchPath) && executableExists(current.executable))) return conflict();
      if (enabled) {
        if (!executableExists(launchPath)) throw new Error('The application is missing from its installed location.');
        fs.accessSync(launchPath, fs.constants.X_OK);
      }
      const contents = entry(launchPath, enabled);
      if (current?.contents === contents) return status();
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      if (!current) {
        // Exclusive creation also protects an entry created since the read.
        fs.writeFileSync(file, contents, { flag: 'wx', mode: 0o600 });
      } else {
        // Write through a verified descriptor, never through a replacement link.
        // A different package may not take over a still-installed Ri copy.
        const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
        try {
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.nlink !== 1 || fs.readFileSync(fd, 'utf8') !== current.contents) return conflict();
          const bytes = Buffer.from(contents);
          let written = 0;
          while (written < bytes.length) {
            const count = fs.writeSync(fd, bytes, written, bytes.length - written, written);
            if (!count) throw new Error('The login item could not be fully written.');
            written += count;
          }
          fs.ftruncateSync(fd, bytes.length);
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
      }
      return status();
    } catch (error) { return failure(error); }
  }

  function launchedInBackground(argv = process.argv) {
    if (argv.includes('--ri-background')) return true;
    if (platform !== 'darwin' || !options.app.isPackaged) return false;
    try { return options.app.getLoginItemSettings({ type: 'mainAppService' }).wasOpenedAtLogin; }
    catch { return false; }
  }

  return { status, setEnabled, launchedInBackground };
}
