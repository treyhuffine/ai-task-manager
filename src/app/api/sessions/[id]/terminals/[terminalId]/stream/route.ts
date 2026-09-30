import type { NextRequest } from 'next/server';
import { sessionTerminalPlace, terminalStreamAt } from '@/lib/terminal/place';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const { id, terminalId } = await params;
  return terminalStreamAt(request, () => sessionTerminalPlace(id), terminalId);
}
