import type { NextRequest } from 'next/server';
import { workspaceTerminalOwner } from '@/lib/terminal/owner';
import { deleteTerminalResponse, getTerminalResponse } from '@/lib/terminal/http';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  return getTerminalResponse(workspaceTerminalOwner(id), terminalId);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  return deleteTerminalResponse(workspaceTerminalOwner(id), terminalId);
}
