import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot } from '@/lib/config/paths';
import { reply, type OperationContext } from '@/lib/server/operation';
import { serviceStatus } from '@/lib/service/client';
import { canonical } from '@/lib/service/paths';
import { releaseCommit } from '@/lib/service/release-commit';
import { readStopped } from '@/lib/service/stopped';
import { latestRelease, listHomes, storeDirectory } from '@/lib/service/store';
import { hasLoginSupervision } from '@/lib/service/supervision-state';
import { updateRights, visibleServiceStatus } from '@/lib/service/update-rights';
import { z as rpcZ } from 'zod/v4';

function installed() {
  const id = latestRelease();
  if (!id) return null;
  const repo = path.join(/* turbopackIgnore: true */ storeDirectory(), id, 'server');
  try { return { version: JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ repo, 'package.json'), 'utf8')).version as string, commit: releaseCommit(repo) }; }
  catch { return null; }
}

/** What Settings > This computer shows, the same facts as `ri status` (4.2). */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const rights = updateRights(request);
  if (!rights.use) return reply({ error: 'The owner of this computer manages it.' }, { status: 403 });
  const status = visibleServiceStatus(await serviceStatus().catch(() => null), rights);
  const root = canonical(getAppRoot());
  return reply({ root, status, supervised: hasLoginSupervision(), stopped: readStopped(), computer: installed(),
    homeCommit: status?.repo ? releaseCommit(status.repo) : null,
    otherHomes: listHomes().flatMap(home => home.identity && home.identity.root !== root ? [home.identity.root] : []),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GETInput = rpcZ.object({}).strict().default({});
