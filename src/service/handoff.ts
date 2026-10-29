/** Unsupervised installations use this short-lived relay to let the previous
 * controller release its owner lease before the new controller starts. It
 * does for them what the launcher does under the OS (docs/always-on-spec.md
 * section 7.4): a new release that exits or hangs twice before it starts work
 * is replaced by the previous one, which restores the snapshot first. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir, servicePaths } from '@/lib/service/paths';
import { activationDirectory, readActivation } from '@/lib/service/activation';
import { releaseDirectory } from '@/lib/service/store';
const [parentText, node, repo] = process.argv.slice(2);
const parent = Number(parentText);
const deadlineMs = Number(process.env.RI_ACTIVATION_DEADLINE_SECONDS ?? 300) * 1000;

function startController(controllerNode: string, controllerRepo: string): Promise<ChildProcess> {
  const log = fs.openSync(servicePaths().log, 'a', 0o600);
  try {
    const child = spawn(controllerNode, [path.join(controllerRepo, 'dist/service/main.cjs')], { cwd: controllerRepo, detached: true, stdio: ['ignore', log, log], env: { ...process.env, RI_RUNTIME_REPO: controllerRepo } });
    return new Promise((resolve, reject) => { child.once('spawn', () => resolve(child)); child.once('error', reject); });
  } finally { fs.closeSync(log); }
}

/** Resolves true once the candidate started work, false if it exited or hung first. */
async function startedWork(child: ChildProcess, candidate: string) {
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (readActivation().candidate !== candidate) return true;
    const done = await Promise.race([exited.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 250))]);
    if (done) return readActivation().candidate !== candidate;
  }
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 15_000))]);
  return false;
}

async function handoff() {
  if (!Number.isSafeInteger(parent) || !node || !repo || !path.isAbsolute(node) || !path.isAbsolute(repo)) throw new Error('Invalid service handoff');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    let alive = true; try { process.kill(parent, 0); } catch { alive = false; }
    if (!alive) {
      const activation = readActivation();
      const install = getRuntimeInstallDir();
      const candidate = activation.candidate;
      const starting = candidate && path.resolve(releaseDirectory(candidate, install), 'server') === path.resolve(repo) ? candidate : null;
      let child = await startController(node, repo);
      if (!starting) { child.unref(); return; }
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (await startedWork(child, starting)) { child.unref(); return; }
        if (attempt === 1) child = await startController(node, repo);
      }
      const previous = activation.previous;
      if (!previous) throw new Error('The new release did not start and no previous release is recorded');
      atomicWriteFile(path.join(install, 'active-release'), `${previous}\n`);
      fs.writeFileSync(path.join(activationDirectory(install), 'restore'), '');
      fs.rmSync(path.join(activationDirectory(install), 'candidate'), { force: true });
      const back = releaseDirectory(previous, install);
      (await startController(path.join(back, 'node/bin/node'), path.join(back, 'server'))).unref();
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Previous controller did not release ownership');
}
void handoff().catch(error => { console.error('[service] Handoff failed', error); process.exitCode = 1; });
