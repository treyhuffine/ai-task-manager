import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { getUserState, updateUserState } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';
import { isValidInactiveAfterDays, MAX_INACTIVE_AFTER_DAYS } from '@/lib/sessions/inactive';
import { normalizeOrchestratorName, ORCHESTRATOR_NAME_MAX } from '@/lib/orchestrator/name';
import { parseOrchestratorLook } from '@/lib/orchestrator/look';
import { attachmentPath } from '@/lib/attachments/save';
import { recycleAppMainChats } from '@/lib/executor/adapter';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    const row = getUserState();
    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if ('executionInactiveAfterDays' in body && !isValidInactiveAfterDays(body.executionInactiveAfterDays)) {
      return Response.json(
        { error: `executionInactiveAfterDays must be null (default), 0 (never), or whole days up to ${MAX_INACTIVE_AFTER_DAYS}` },
        { status: 400 },
      );
    }
    const renaming = 'orchestratorName' in body;
    if (renaming) {
      if (body.orchestratorName !== null && typeof body.orchestratorName !== 'string') {
        return Response.json({ error: 'orchestratorName must be a string, or null for the default' }, { status: 400 });
      }
      // Stored folded to one line, and null when blank (back to the default).
      body.orchestratorName = normalizeOrchestratorName(body.orchestratorName);
      if (body.orchestratorName && body.orchestratorName.length > ORCHESTRATOR_NAME_MAX) {
        return Response.json(
          { error: `orchestratorName can be at most ${ORCHESTRATOR_NAME_MAX} characters` },
          { status: 400 },
        );
      }
    }
    // The look: one emoji, a palette color, an image that was really uploaded.
    const look = parseOrchestratorLook(body);
    if ('error' in look) return Response.json({ error: look.error }, { status: 400 });
    if (look.patch.orchestratorImage && !fs.existsSync(attachmentPath(look.patch.orchestratorImage.fileName))) {
      return Response.json({ error: 'orchestratorImage names a file that was never uploaded' }, { status: 400 });
    }
    Object.assign(body, look.patch);
    if (
      'orchestratorIntroducedAt' in body &&
      body.orchestratorIntroducedAt !== null &&
      (typeof body.orchestratorIntroducedAt !== 'string' || Number.isNaN(Date.parse(body.orchestratorIntroducedAt)))
    ) {
      return Response.json({ error: 'orchestratorIntroducedAt must be a timestamp, or null' }, { status: 400 });
    }
    const before = renaming ? getUserState()?.orchestratorName ?? null : null;
    const row = updateUserState(body);
    // The name lives in the main chat's brief, which is fixed when its
    // process starts. Recycle it (now if idle, else when the turn ends) so
    // the next reply comes from a process that knows the new name.
    if (renaming && row && (row.orchestratorName ?? null) !== before) {
      await recycleAppMainChats().catch((err) => {
        console.warn('[PATCH /api/user-state] could not recycle the main chat after a rename', err);
      });
    }
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
