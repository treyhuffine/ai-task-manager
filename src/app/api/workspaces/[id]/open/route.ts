import type { NextRequest } from 'next/server';
import { agentOpenPlace, openOnViewerDevice } from '@/lib/open/on-viewer';

/**
 * Open the agent's own folder, or a file in it, in an app on the device
 * it lives on, for a browser on that device (P3.5). Also lists the apps
 * installed there. See `src/lib/open/on-viewer.ts`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return openOnViewerDevice(request, agentOpenPlace(id));
}
