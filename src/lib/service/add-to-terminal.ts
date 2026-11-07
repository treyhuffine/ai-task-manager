/**
 * "Add `ri` to Terminal" (docs/always-on-spec.md 4.2): the same launcher the
 * install script writes, plus the one line that puts its folder on the PATH, and
 * a plain account of what changed. macOS ships Ruby's own `ri` in /usr/bin, so the
 * folder has to come first.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandLauncherPath, installCommandLauncher } from './runtime';

export function shellProfile(shell: string | undefined, platform: NodeJS.Platform, home: string) {
  const name = path.basename(shell ?? (platform === 'darwin' ? 'zsh' : 'bash'));
  if (name === 'fish') return { file: path.join(/* turbopackIgnore: true */ home, '.config/fish/conf.d/ri.fish'), line: (folder: string) => `fish_add_path -p ${folder}` };
  const file = name === 'zsh' ? '.zprofile' : name === 'bash' ? (platform === 'darwin' ? '.bash_profile' : '.profile') : '.profile';
  return { file: path.join(/* turbopackIgnore: true */ home, file), line: (folder: string) => `export PATH="${folder}:$PATH"` };
}

export interface AddedToTerminal { installed: boolean; changed: string[]; message: string }

export function addToTerminal(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): AddedToTerminal {
  const launcher = installCommandLauncher();
  if (!launcher.installed) return { installed: false, changed: [], message: launcher.reason ?? `Ri couldn't write ${commandLauncherPath()}.` };
  const home = env.HOME ?? os.homedir();
  const folder = path.dirname(/* turbopackIgnore: true */ launcher.file);
  const shown = (file: string) => file.startsWith(`${home}/`) ? `~/${file.slice(home.length + 1)}` : file;
  const inHome = folder.startsWith(`${home}/`) ? `$HOME/${folder.slice(home.length + 1)}` : folder;
  const profile = shellProfile(env.SHELL, platform, home);
  const current = fs.existsSync(/* turbopackIgnore: true */ profile.file) ? fs.readFileSync(/* turbopackIgnore: true */ profile.file, 'utf8') : '';
  const changed = [shown(launcher.file)];
  if (current.includes(inHome) || current.includes(folder)) {
    return { installed: true, changed, message: `\`ri\` is ready at ${shown(launcher.file)}. ${shown(profile.file)} already has its folder on the PATH.` };
  }
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(/* turbopackIgnore: true */ profile.file), { recursive: true });
  fs.appendFileSync(/* turbopackIgnore: true */ profile.file, `${current && !current.endsWith('\n') ? '\n' : ''}\n# Added by Ri\n${profile.line(inHome)}\n`);
  changed.push(shown(profile.file));
  return { installed: true, changed, message: `\`ri\` is ready at ${shown(launcher.file)}. Added its folder to the PATH in ${shown(profile.file)}. Open a new terminal window to use it.` };
}
