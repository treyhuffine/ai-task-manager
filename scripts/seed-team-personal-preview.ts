/** Fictional personal Home for comparing the shared app, connected to a synthetic Team. */
import fs from 'node:fs';
import path from 'node:path';
import { runSeed } from './seed-dev/seed';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { ensureLocalToken } from '@/lib/auth/bootstrap';
import { getAppRoot, getDbPath, getConfigDir, getWorkDir, getProductionAppRoot, getDevAppRoot, getTestAppRoot } from '@/lib/config/paths';
import { isWithin } from '@/lib/config/dev-isolation';
import { saveTeamKey } from '@/lib/spaces/credentials';
import { teamTRPC } from '@/lib/spaces/remote';
import { saveTeamConnection } from '@/lib/db/queries';

async function main() {
  if (!process.env.RI_ROOT || !process.argv[2]) throw new Error('Run through pnpm iso <empty-root> --init -- ... with a synthetic Team preview.json.');
  for (const candidate of [getAppRoot(), getDbPath(), getConfigDir(), getWorkDir()]) {
    if ([getProductionAppRoot(), getDevAppRoot(), getTestAppRoot()].some(root => isWithin(candidate, root))) throw new Error('This seed requires a separate disposable Home.');
  }
  if (fs.existsSync(getDbPath())) throw new Error('Choose an empty disposable Home.');
  const preview = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as { ownerUrl: string };
  const teamUrl = new URL(preview.ownerUrl);
  if (!['localhost', '127.0.0.1'].includes(teamUrl.hostname)) throw new Error('Only a local synthetic Team is accepted.');
  const token = new URLSearchParams(teamUrl.hash.slice(1)).get('token')!;
  const identity = await teamTRPC(teamUrl.origin, token).team.me.query();
  ensureHomeIdentity();
  const local = ensureLocalToken();
  await runSeed();
  await saveTeamKey(identity.team.id, identity.member.id, token);
  saveTeamConnection({ id: identity.team.id, name: identity.team.name, url: teamUrl.origin, memberId: identity.member.id, memberName: identity.member.name, role: identity.member.role });
  const base = `http://localhost:${process.env.PORT ?? '42333'}`;
  const result = { root: getAppRoot(), ownerUrl: `${base}/#token=${local.plaintext}`, spaceUrl: `${base}/space/${identity.team.id}`, teamId: identity.team.id };
  fs.writeFileSync(path.join(getAppRoot(), 'preview.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
