import type { NextRequest } from 'next/server';
import { openOnViewerDevice, sessionOpenPlace } from '@/lib/open/on-viewer';

/**
 * Open this execution's worktree, or a file in it, in an app on the
 * device it runs on, for a browser on that device (P3.5). Also lists
 * the apps installed there. See `src/lib/open/on-viewer.ts`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return openOnViewerDevice(request, sessionOpenPlace(id));
}
