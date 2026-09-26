import type { NextRequest } from 'next/server';
import { deleteTerminalAt, getTerminalAt, agentTerminalPlace } from '@/lib/terminal/place';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  return getTerminalAt(agentTerminalPlace(id), terminalId);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  return deleteTerminalAt(agentTerminalPlace(id), terminalId);
}
