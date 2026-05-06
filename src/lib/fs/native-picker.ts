/**
 * Spawn the native OS folder dialog and return the selected absolute path.
 *
 * The app runs locally — the same machine browser is on, so shelling out to
 * a native dialog from the request handler puts the picker in front of the
 * actual user. This is what local-first desktop-style web apps typically do
 * (Conductor takes the same shape via Tauri; we take it via the local server).
 *
 * Returns:
 *   - { path: string }  — user picked a folder
 *   - { cancelled: true } — user dismissed the dialog
 *   - { unsupported: true; reason } — no native picker on this platform
 */

import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export type PickFolderResult =
  | { path: string }
  | { cancelled: true }
  | { unsupported: true; reason: string };

/** AppleScript escapes: backslash first, then quotes; flatten newlines so the single `-e` line stays valid. */
function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

/**
 * macOS: AppleScript's `choose folder`. We bring System Events forward
 * first so the dialog isn't hidden behind the calling Terminal/Finder.
 */
async function pickFolderMac(prompt: string): Promise<PickFolderResult> {
  const script = [
    'tell application "System Events" to activate',
    `set chosen to (choose folder with prompt "${escapeAppleScriptString(prompt)}")`,
    'POSIX path of chosen',
  ].join('\n');
  try {
    const { stdout } = await execFileP('osascript', ['-e', script], { timeout: 10 * 60 * 1000 });
    const path = stdout.trim().replace(/\/$/, '');
    return path ? { path } : { cancelled: true };
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string })?.stderr ?? '';
    // AppleScript raises `error number -128` on user cancel — locale-independent
    // (the en-US "User canceled" message doesn't appear on non-English systems).
    if (stderr.includes('-128')) {
      return { cancelled: true };
    }
    throw err;
  }
}

/**
 * Linux: try the desktop-appropriate native dialog. KDE ships kdialog,
 * GNOME and most others ship zenity. Try the env-preferred one first,
 * fall back to the other; mark unsupported only if neither is installed.
 */
async function pickFolderLinux(prompt: string): Promise<PickFolderResult> {
  const isKDE = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase().includes('KDE');
  const order: Array<'kdialog' | 'zenity'> = isKDE ? ['kdialog', 'zenity'] : ['zenity', 'kdialog'];

  for (const tool of order) {
    try {
      const args =
        tool === 'kdialog'
          ? ['--title', prompt, '--getexistingdirectory', os.homedir()]
          : ['--file-selection', '--directory', `--title=${prompt}`];
      const { stdout } = await execFileP(tool, args, { timeout: 10 * 60 * 1000 });
      const path = stdout.trim();
      return path ? { path } : { cancelled: true };
    } catch (err: unknown) {
      const e = err as { code?: number | string };
      // Both tools exit 1 on user cancel — that's a real cancel, don't fall through.
      if (e?.code === 1) return { cancelled: true };
      // Tool isn't installed — try the next one in the preference order.
      if (e?.code === 'ENOENT') continue;
      throw err;
    }
  }

  return {
    unsupported: true,
    reason: 'Install kdialog (KDE) or zenity (GNOME/others) for native folder picking',
  };
}

/** Windows: PowerShell + WinForms FolderBrowserDialog with a topmost owner. */
async function pickFolderWindows(prompt: string): Promise<PickFolderResult> {
  // - TopMost owner form keeps the dialog above the browser; without an
  //   owner FolderBrowserDialog often appears behind whatever's foreground.
  // - WinForms requires STA. Windows PowerShell 5.1 is STA by default,
  //   PowerShell 7+ (pwsh) defaults to MTA — `-STA` covers both.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${prompt.replace(/'/g, "''")}'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog($owner) -eq 'OK') { Write-Output $dialog.SelectedPath }
`;
  const { stdout } = await execFileP(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
    { timeout: 10 * 60 * 1000 },
  );
  const path = stdout.trim();
  return path ? { path } : { cancelled: true };
}

export async function pickFolder(prompt = 'Choose a workspace folder'): Promise<PickFolderResult> {
  switch (process.platform) {
    case 'darwin':
      return pickFolderMac(prompt);
    case 'linux':
      return pickFolderLinux(prompt);
    case 'win32':
      return pickFolderWindows(prompt);
    default:
      return { unsupported: true, reason: `Unsupported platform: ${process.platform}` };
  }
}
