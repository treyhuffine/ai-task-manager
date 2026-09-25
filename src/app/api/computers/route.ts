/**
 * This home's computers, with what each worker last reported and whether
 * it's connected now (docs/homes-build.md, P2.2). The home's own computer
 * runs work in process, so it has no worker and is always available while
 * the home answers.
 */

import { getHome, listComputers, listEnrolledComputerIds } from '@/lib/db/queries';
import { isComputerConnected } from '@/lib/workers/hub';

export async function GET() {
  const hostId = getHome()?.hostComputerId ?? null;
  const enrolled = listEnrolledComputerIds();
  const computers = listComputers().map((c) => ({
    id: c.id,
    name: c.name,
    platform: c.platform,
    hostname: c.hostname,
    status: c.status,
    isHome: c.id === hostId,
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
