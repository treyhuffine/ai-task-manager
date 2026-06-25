import { NextResponse } from 'next/server';
import { listPendingApprovals } from '@/lib/connectors/approval';
import { getConnectorOwnerId } from '@/lib/connectors/runtime';

/** Connector actions awaiting human approval (mutating actions the agent attempted). */
export async function GET() {
  return NextResponse.json({ pending: listPendingApprovals(getConnectorOwnerId()) });
}
