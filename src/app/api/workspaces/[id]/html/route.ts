/**
 * GET /api/workspaces/:id/html?path=<relative to the agent's folder>&theme=light|dark
 *
 * An HTML file from an agent's own folder, served as the document its
 * preview iframe loads (`src/lib/sessions/html-preview-response.ts`). The
 * same reach as `/api/workspaces/:id/file`: inside the folder only, on the
 * device the agent lives on.
 *
 * Auth: bearer token or the session cookie (`src/proxy.ts`), which is what an
 * iframe sends.
 */

import path from 'node:path';
import { NextRequest } from 'next/server';
import { getDevice, getWorkspace } from '@/lib/db/queries';
import { agentDeviceFor } from '@/lib/setups/run-on';
import {
  HTML_FILE,
  htmlAnswerPreviewResponse,
  htmlFilePreviewResponse,
  htmlPreviewErrorResponse,
  htmlPreviewTheme,
} from '@/lib/sessions/html-preview-response';
import { isExistingDir } from '@/lib/terminal/owner';
import { agentFolderAnswer } from '@/lib/workspaces/agent-folder-operations';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const theme = htmlPreviewTheme(request.nextUrl.searchParams.get('theme'));
  try {
    const { id } = await params;
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return htmlPreviewErrorResponse(400, 'This preview needs a file path.', theme);
    if (!HTML_FILE.test(requested)) return htmlPreviewErrorResponse(415, 'Only HTML files open in this preview.', theme);

    const ws = getWorkspace(id);
    if (!ws) return htmlPreviewErrorResponse(404, 'This agent no longer exists.', theme);

    // An agent that lives on another device: that device reads its folder.
    const deviceId = agentDeviceFor(id);
    if (deviceId) {
      const answer = await agentFolderAnswer(id, { kind: 'file', path: requested, base: false });
      return htmlAnswerPreviewResponse(request, answer, theme, getDevice(deviceId)?.name ?? 'its device');
    }

    if (!isExistingDir(ws.cwd)) return htmlPreviewErrorResponse(409, `The agent's folder does not exist: ${ws.cwd}`, theme);
    const relative = sanitizeRelPath(requested);
    if (!relative) return htmlPreviewErrorResponse(400, `Invalid path: ${requested}`, theme);
    return await htmlFilePreviewResponse(request, path.join(ws.cwd, relative), theme);
  } catch (err) {
    console.error('[GET /api/workspaces/:id/html]', err);
    return htmlPreviewErrorResponse(500, 'This preview could not be loaded.', theme);
  }
}
