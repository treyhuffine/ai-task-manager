import fs from 'node:fs';
import path from 'node:path';

/** The commit a staged release was built from, if it came from a checkout. */
export function releaseCommit(repo: string): string | null {
  try {
    const { commit } = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ repo, 'ri-release.json'), 'utf8')) as { commit?: string };
    return typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
  } catch { return null; }
}
