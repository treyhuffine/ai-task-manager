import { NextResponse } from 'next/server';
import { listPendingApprovals } from '@/lib/connectors/approval';
import { getConnectorOwnerId } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';

/** Connector actions awaiting human approval (mutating actions the agent attempted). */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  return NextResponse.json({ pending: listPendingApprovals(getConnectorOwnerId()) });
}
