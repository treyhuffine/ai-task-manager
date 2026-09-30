import type { NextRequest } from 'next/server';
import { agentOpenPlace, openOnViewerComputer } from '@/lib/open/on-viewer';

/**
 * Open the agent's own folder, or a file in it, in an app on the computer
 * it lives on, for a browser on that computer (P3.5). Also lists the apps
 * installed there. See `src/lib/open/on-viewer.ts`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return openOnViewerComputer(request, agentOpenPlace(id));
}
