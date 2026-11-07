/**
 * The last step of the install script (docs/always-on-spec.md section 5): check a
 * downloaded release against the publisher's signature and its own manifest, store
 * it, and write the `ri` command. It touches no Home. `ri start` does that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeOrigin } from './origin';
import { verifyRelease } from './release-trust';
import { commandLauncherPath, installCommandLauncher } from './runtime';
import { verifyRuntime } from './runtime-manifest';
import { stageRelease } from './store';

export function installPublishedRelease(resources: string, envelope: unknown, publicKey: string, channel: 'stable' | 'latest' = 'stable') {
  const release = verifyRelease(envelope, { publicKey, channel });
  const manifest = verifyRuntime(resources);
  if (manifest.id !== release.runtime.id || manifest.version !== release.version) throw new Error('This download is not the release its publisher signed.');
  // The release must trust the key the script does, or its updates would come from someone else.
  const policyFile = path.join(/* turbopackIgnore: true */ resources, 'release-policy.json');
  if (!fs.existsSync(/* turbopackIgnore: true */ policyFile)) throw new Error('This release has no publisher settings, so it could never update itself.');
  const policy = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ policyFile, 'utf8')) as { publicKey?: string };
  if (policy.publicKey?.trim() !== publicKey.trim()) throw new Error('This release trusts a different publisher than this script.');
  stageRelease(resources);
  writeOrigin({ source: 'published', channel });
  const launcher = installCommandLauncher();
  return { version: release.version, id: manifest.id, launcher, command: commandLauncherPath() };
}
