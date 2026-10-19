/**
 * GET /api/workspaces/:id/pdf?path=<relative to the agent's folder>
 *   [&download=1 | &thumbnail=1 | &page=N]
 *
 * A PDF from an agent's own folder: its bytes for the browser's viewer, a
 * download, or page images (`src/lib/attachments/pdf-delivery.ts`). The same
 * reach as `/api/workspaces/:id/file`: inside the folder only.
 *
 * Auth: bearer token or the session cookie (`src/proxy.ts`), which is what
 * the preview's iframe and a download link send.
 */

import path from 'node:path';
import { NextRequest } from 'next/server';
import { getDevice, getWorkspace } from '@/lib/db/queries';
import { PDF_FILE, pdfError, pdfResponse } from '@/lib/attachments/pdf-delivery';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { isExistingDir } from '@/lib/terminal/owner';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return pdfError(400, 'Missing path parameter');
    if (!PDF_FILE.test(requested)) return pdfError(415, 'Only PDF files open here.');

    const ws = getWorkspace(id);
    if (!ws) return pdfError(404, 'This agent no longer exists.');

    const deviceId = agentDeviceFor(id);
    if (deviceId) {
      const device = getDevice(deviceId)?.name ?? 'its device';
      return pdfError(409, `This PDF is on ${device}. PDFs on another device don't preview here yet.`);
    }
    if (!isExistingDir(ws.cwd)) return pdfError(409, `The agent's folder does not exist: ${ws.cwd}`);
    const relative = sanitizeRelPath(requested);
    if (!relative) return pdfError(400, `Invalid path: ${requested}`);
    return await pdfResponse(request, path.join(ws.cwd, relative), path.basename(relative));
  } catch (err) {
    console.error('[GET /api/workspaces/:id/pdf]', err);
    return pdfError(500, 'This PDF could not be opened.');
  }
}
