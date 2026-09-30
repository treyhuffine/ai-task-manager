import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const revision = 1;
const name = 'Ri Demo';

/** app.setName only changes Electron's internal name. macOS reads its menu and
 * Dock identity from the app bundle. Keep a locally signed development copy,
 * never mutate pnpm's shared Electron install or use the packaged data paths.
 * @param {{ electron: string, repo: string, platform?: NodeJS.Platform, run?: (command: string, args: string[]) => unknown }} options
 */
export function developmentExecutable({ electron, repo, platform = process.platform, run = execFileSync }) {
  if (platform !== 'darwin') return electron;
  const original = fs.realpathSync(electron);
  const source = path.dirname(path.dirname(path.dirname(original)));
  const plist = path.join(source, 'Contents/Info.plist');
  if (!source.endsWith('.app') || !fs.statSync(plist).isFile()) throw new Error('The development Electron executable is not in a macOS app bundle.');
  const icon = path.join(repo, 'assets/brand/icons/icon.icns');
  const sourceStat = fs.statSync(original);
  const identity = createHash('sha256').update(fs.realpathSync(repo)).digest('hex').slice(0, 16);
  const key = createHash('sha256').update(JSON.stringify({ revision, original, size: sourceStat.size, modified: sourceStat.mtimeMs }))
    .update(fs.readFileSync(plist)).update(fs.readFileSync(icon)).digest('hex').slice(0, 20);
  const cache = path.join(repo, '.electron-demo/development-shell');
  const target = path.join(cache, key);
  const executable = path.join(target, `${name}.app/Contents/MacOS`, path.basename(original));
  const complete = path.join(target, 'complete.json');
  if (fs.existsSync(complete) && fs.existsSync(executable)) return executable;
  fs.mkdirSync(cache, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cache, '.prepare-'));
  try {
    const bundle = path.join(temporary, `${name}.app`);
    fs.cpSync(source, bundle, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, mode: fs.constants.COPYFILE_FICLONE });
    const copiedPlist = path.join(bundle, 'Contents/Info.plist');
    const values = {
      CFBundleName: name, CFBundleDisplayName: name, CFBundleIdentifier: `app.ri.desktop.demo.${identity}`,
      NSMicrophoneUsageDescription: 'Ri uses the microphone when you record a voice message.',
      NSCameraUsageDescription: 'Ri uses the camera when you scan a pairing code.',
    };
    for (const [key, value] of Object.entries(values)) run('/usr/bin/plutil', ['-replace', key, '-string', value, copiedPlist]);
    // Retain the executable name and default_app.asar so Electron continues to
    // report isPackaged=false and opens the live dist/desktop/main.cjs entry.
    fs.copyFileSync(icon, path.join(bundle, 'Contents/Resources/electron.icns'));
    run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
    run('/usr/bin/codesign', ['--verify', '--strict', bundle]);
    fs.writeFileSync(path.join(temporary, 'complete.json'), JSON.stringify({ revision, key, identity }));
    try { fs.renameSync(temporary, target); }
    catch (error) {
      // Two independent launches can prepare the same cache simultaneously.
      if (!fs.existsSync(complete) || !fs.existsSync(executable)) throw error;
    }
    return executable;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
