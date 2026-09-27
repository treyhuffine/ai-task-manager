import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Run before signing and runtime inventory so helper bytes have the same
 * publisher trust and update boundary as the bundled ordinary Node. */
export function stageSpeechHelper(source, destination) {
  if (!fs.existsSync(path.join(source, 'build.json'))) throw new Error('Build the optional speech helper first with pnpm speech:build.');
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'build.json'), 'utf8'));
  if (metadata.protocol !== 1 || metadata.platform !== process.platform || metadata.arch !== process.arch) throw new Error('Speech helper must be built for this OS and architecture.');
  for (const file of ['ri-speech-helper', 'NOTICES.md', 'requirements.txt']) if (!fs.statSync(path.join(source, file)).isFile()) throw new Error(`Speech helper is missing ${file}.`);
  const result = spawnSync(path.join(source, 'ri-speech-helper'), ['--version'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4096 });
  if (result.error || result.status !== 0) throw new Error(`Speech helper native probe failed: ${result.error?.message ?? result.stderr}`);
  fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  console.info(`Included optional managed speech helper (${metadata.platform}/${metadata.arch}). Models download only after opting in.`);
}
