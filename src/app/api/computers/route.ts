/**
 * This home's computers, with what each worker last reported and whether
 * it's connected now (docs/homes-build.md, P2.2). The home's own computer
 * runs work in process, so it has no worker and is always available while
 * the home answers.
 */

import { getHome, listComputers, listEnrolledComputerIds } from '@/lib/db/queries';
import { isComputerConnected } from '@/lib/workers/hub';
import { hostIsPortable } from '@/lib/home/portable';

export async function GET() {
  const hostId = getHome()?.hostComputerId ?? null;
  const portable = await hostIsPortable();
  const enrolled = listEnrolledComputerIds();
  const computers = listComputers().map((c) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    hostname: c.hostname,
    status: c.status,
    isHome: c.id === hostId,
    // The home on a laptop: its schedules run only while it's awake (P3.4).
    portable: c.id === hostId ? portable : undefined,
    lastSeenAt: c.lastSeenAt,
    worker:
      c.id === hostId
        ? null
        : {
            enrolled: enrolled.has(c.id),
            connected: isComputerConnected(c.id),
            protocol: c.workerProtocol,
            version: c.workerVersion,
            reportedState: c.reportedState,
          },
  }));
  return Response.json(computers);
}
