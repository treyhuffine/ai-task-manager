import type { NextRequest } from 'next/server';
import { openOnViewerComputer, sessionOpenPlace } from '@/lib/open/on-viewer';

/**
 * Open this execution's worktree, or a file in it, in an app on the
 * computer it runs on, for a browser on that computer (P3.5). Also lists
 * the apps installed there. See `src/lib/open/on-viewer.ts`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return openOnViewerComputer(request, sessionOpenPlace(id));
}
