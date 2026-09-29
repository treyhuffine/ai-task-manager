import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loginExecArgument } from './login';

export const DESKTOP_PORTAL_ID = 'app.ri.desktop.desktop';
const MARKER = '# Ri desktop portal identity v1: ';
const conflict = () => new Error('The Ri desktop entry belongs to another installation or was edited outside Ri. It was left unchanged. Repair the installed Ri desktop entry before enabling its global shortcut.');

interface PortalOptions {
  executable?: string;
  appImage?: string;
  home?: string;
  dataHome?: string;
  dataDirs?: string[];
  pathEnv?: string;
  platform?: NodeJS.Platform;
  wayland?: boolean;
}

function contents(executable: string) {
  return [
    '[Desktop Entry]', `${MARKER}${JSON.stringify({ executable })}`,
    'Type=Application', 'Name=Ri', 'Comment=Ri desktop shortcut identity',
    `Exec=${loginExecArgument(executable)} --ri-use-saved-installation`,
    // This supplies portal identity without adding a duplicate launcher beside
    // one installed by an AppImage manager. It does not start an OS login job.
    'NoDisplay=true', 'Terminal=false', '',
  ].join('\n');
}

function ownedExecutable(value: string) {
  try {
    const marker = value.split('\n').find(line => line.startsWith(MARKER));
    if (!marker) return;
    const parsed = JSON.parse(marker.slice(MARKER.length)) as { executable?: unknown };
    if (typeof parsed.executable === 'string' && path.isAbsolute(parsed.executable) && contents(parsed.executable) === value) return parsed.executable;
  } catch { /* Unknown format is not ours to modify. */ }
}

function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function sameExecutable(left: string, right: string) {
  try { return fs.realpathSync(left) === fs.realpathSync(right); } catch { return false; }
}
function exists(file: string) {
  try { fs.statSync(file); return true; } catch (error) { if (missing(error)) return false; throw error; }
}

function desktopValue(value: string) {
  return value.replace(/\\(.)/g, (_, escaped: string) => {
    const chars: Record<string, string> = { s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' };
    if (!(escaped in chars)) throw new Error('Invalid desktop escape');
    return chars[escaped];
  });
}

/** Read the executable token according to desktop-entry rules, never a shell.
 * Existing package-manager entries may contain normal %U trailing arguments. */
function execToken(value: string) {
  const decoded = desktopValue(value);
  let token = ''; let quoted = false; let quoteClosed = false;
  for (let index = 0; index < decoded.length; index++) {
    const char = decoded[index];
    if (!quoted && /\s/.test(char)) { if (token || quoteClosed) break; continue; }
    if (quoteClosed) throw new Error('Executable arguments must be quoted in whole');
    if (char === '"') {
      if (quoted) { quoted = false; quoteClosed = true; }
      else { if (token) throw new Error('Executable arguments must be quoted in whole'); quoted = true; }
      continue;
    }
    if (char === '\\') {
      const next = decoded[++index];
      if (!quoted || !next || !'"`$\\'.includes(next)) throw new Error('Invalid executable escape');
      token += next; continue;
    }
    if ((!quoted && /['><~|&;$*?#()`]/.test(char)) || /[\u0000-\u001f\u007f]/.test(char)) throw new Error('Invalid executable token');
    token += char;
  }
  if (quoted || !token) throw new Error('Invalid executable token');
  if (/%(?!%)/.test(token.replaceAll('%%', ''))) throw new Error('Executable field codes are unsupported');
  return token.replaceAll('%%', '%');
}

function resolvesTo(value: string, executable: string, pathEnv: string) {
  const candidate = path.isAbsolute(value) ? value : !value.includes('/')
    ? pathEnv.split(path.delimiter).filter(path.isAbsolute).map(directory => path.join(directory, value)).find(file => {
      try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
    }) : undefined;
  return !!candidate && sameExecutable(candidate, executable);
}

function matchingInstalledEntry(value: string, executable: string, pathEnv: string) {
  try {
    const entries = new Map<string, string>(); let inEntry = false;
    for (const line of value.split(/\r?\n/)) {
      if (line.startsWith('[')) { inEntry = line === '[Desktop Entry]'; continue; }
      if (!inEntry || !line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) return false;
      const key = line.slice(0, separator);
      if (entries.has(key)) return false;
      entries.set(key, line.slice(separator + 1));
    }
    if (entries.get('Type') !== 'Application' || !entries.get('Name') || entries.get('Hidden') === 'true' || entries.get('DBusActivatable') === 'true') return false;
    const command = entries.get('Exec');
    if (!command || !resolvesTo(execToken(command), executable, pathEnv)) return false;
    const tryExec = entries.get('TryExec');
    return !tryExec || resolvesTo(desktopValue(tryExec), executable, pathEnv);
  } catch { return false; }
}

/** Called only when a user enables/restores their opted-in Wayland shortcut.
 * GNOME resolves portal identities through installed desktop entries. An
 * AppImage's embedded entry alone is not an installed desktop identity.
 * Never install on a status read or modify an existing package-manager entry. */
export function ensureDesktopPortalIdentity(options: PortalOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const wayland = options.wayland ?? (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
  if (platform !== 'linux' || !wayland) return;
  const image = options.appImage ?? process.env.APPIMAGE;
  const executable = image || options.executable || process.execPath;
  if (!path.isAbsolute(executable) || executable.includes('=') || /[\u0000-\u001f\u007f]/.test(executable)) throw new Error('Ri needs an absolute installed application path without control characters or an equals sign for Wayland shortcuts.');
  if (/(?:^|\/)\.mount_[^/]+(?:\/|$)/.test(executable)) throw new Error('The original AppImage location is unavailable. Run Ri from its saved AppImage before enabling its global shortcut.');
  try {
    if (!fs.statSync(executable).isFile()) throw new Error('Not an executable file');
    fs.accessSync(executable, fs.constants.X_OK);
  } catch { throw new Error('Ri could not find its installed executable. Move or reinstall the application before enabling its global shortcut.'); }
  const home = options.home ?? os.homedir();
  const requestedData = options.dataHome ?? process.env.XDG_DATA_HOME;
  const dataHome = requestedData && path.isAbsolute(requestedData) ? requestedData : path.join(home, '.local/share');
  const dataDirs = options.dataDirs ?? (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  const search = [...new Set([dataHome, ...dataDirs.filter(path.isAbsolute)])];
  const target = path.join(dataHome, 'applications', DESKTOP_PORTAL_ID);
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '/usr/bin:/bin';
  let prior: string | undefined;
  for (const directory of search) {
    const file = path.join(directory, 'applications', DESKTOP_PORTAL_ID);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); } catch (error) { if (missing(error)) continue; throw error; }
    let source: string;
    try { source = fs.readFileSync(file, 'utf8'); } catch { throw conflict(); }
    if (matchingInstalledEntry(source, executable, pathEnv)) return;
    const owner = ownedExecutable(source);
    // Only this exact private file may be repaired after moving an AppImage.
    // Higher-priority entries must never shadow a different installed copy.
    if (file !== target || !stat.isFile() || stat.nlink !== 1 || !owner || exists(owner)) throw conflict();
    prior = source;
    break;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const desired = contents(executable);
  if (prior === undefined) {
    fs.writeFileSync(target, desired, { flag: 'wx', mode: 0o600 });
  } else {
    const descriptor = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1 || fs.readFileSync(descriptor, 'utf8') !== prior) throw conflict();
      const bytes = Buffer.from(desired); let written = 0;
      while (written < bytes.length) {
        const count = fs.writeSync(descriptor, bytes, written, bytes.length - written, written);
        if (!count) throw new Error('The Ri desktop entry could not be fully written.');
        written += count;
      }
      fs.ftruncateSync(descriptor, bytes.length);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
  }
}
