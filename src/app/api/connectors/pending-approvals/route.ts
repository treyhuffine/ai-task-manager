import { NextRequest, NextResponse } from 'next/server';
import { listPendingApprovals } from '@/lib/connectors/approval';
import { getConnectorOwnerId } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';

/**
 * Connector actions awaiting human approval (mutating actions the agent attempted). `?sessionId=`
 * narrows to the approvals one chat asked for: its transcript's approval cards read this to know
 * which requests are still live (the session stream pushes the same ids as they change).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') ?? undefined;
  return NextResponse.json({ pending: listPendingApprovals({ ownerId: getConnectorOwnerId(), sessionId }) });
}
