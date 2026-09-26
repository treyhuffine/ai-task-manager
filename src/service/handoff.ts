/** Unsupervised installations use this short-lived relay to let the previous
 * controller release its owner lease before the new controller starts. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { servicePaths } from '@/lib/service/paths';
const [parentText, node, repo] = process.argv.slice(2);
const parent = Number(parentText);
async function handoff() {
  if (!Number.isSafeInteger(parent) || !node || !repo || !path.isAbsolute(node) || !path.isAbsolute(repo)) throw new Error('Invalid service handoff');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    let alive = true; try { process.kill(parent, 0); } catch { alive = false; }
    if (!alive) {
      const log = fs.openSync(servicePaths().log, 'a', 0o600);
      try {
        const child = spawn(node, [path.join(repo, 'dist/service/main.cjs')], { cwd: repo, detached: true, stdio: ['ignore', log, log], env: { ...process.env, RI_RUNTIME_REPO: repo } });
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref(); return;
      } finally { fs.closeSync(log); }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Previous controller did not release ownership');
}
void handoff().catch(error => { console.error('[service] Handoff failed', error); process.exitCode = 1; });
