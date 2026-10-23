import { getRequestKey } from '@/lib/auth/request-key';
import { requireTeamCapability } from '@/lib/team/capability-authority';
import { homeSettingsAdmission } from '@/lib/home/settings-authority';
import { isTeamAuthority } from '@/lib/home/authority';
import { attachmentPath } from '@/lib/attachments/save';
import { getUserState, updateUserState, getMemberPreferences, updateMemberPreferences } from '@/lib/db/queries';
import { userState } from '@/lib/db/schema';
import { recycleAppMainChats } from '@/lib/executor/adapter';
import { parseOrchestratorLook } from '@/lib/orchestrator/look';
import { normalizeOrchestratorName, ORCHESTRATOR_NAME_MAX } from '@/lib/orchestrator/name';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isValidInactiveAfterDays, MAX_INACTIVE_AFTER_DAYS } from '@/lib/sessions/inactive';
import { createInsertSchema } from 'drizzle-zod';
import fs from 'node:fs';
import { z as rpcZ } from 'zod/v4';
import { requestHasSessionAuthority } from '@/lib/orchestrator/mcp-caller';
import { normalizeWorkResultGuidance, WorkResultGuidanceError } from '@/lib/instructions/preferences';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const homeDenied = homeSettingsAdmission(_request.headers, 'read');
  if (homeDenied) return homeDenied;
  try {
    const row = getUserState();
    if (isTeamAuthority() && row) {
      const member = requireTeamCapability(getRequestKey(_request.headers), 'read');
      const preferences = getMemberPreferences(member.id);
      return reply({ ...row, voiceAutoSend: preferences?.voiceAutoSend ?? null, voiceModel: preferences?.voiceModel?.startsWith('web/') ? preferences.voiceModel : 'web/speech-recognition' });
    }
    return reply(row);
  } catch (err) {
    console.error('[GET /api/user-state]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, request: OperationContext) {
  if (isTeamAuthority()) {
    const fields = Object.keys(rpcInput.body);
    const voiceFields = ['voiceAutoSend', 'voiceModel'];
    if (fields.some(key => ![...voiceFields, 'defaultHarness', 'defaultModel', 'defaultVariant', 'defaultEffort'].includes(key))) return reply({ error: 'Choose only model defaults or your own voice preferences.' }, { status: 403 });
    const homeDenied = homeSettingsAdmission(request.headers, fields.every(key => voiceFields.includes(key)) ? 'read' : 'manageSignIns');
    if (homeDenied) return homeDenied;
    const key = getRequestKey(request.headers);
    if (key?.scope !== 'member' || requestHasSessionAuthority(request.headers)) return reply({ error: 'Only a signed-in person can change these preferences.' }, { status: 403 });
    const member = requireTeamCapability(key, 'read');
    const { voiceAutoSend, voiceModel, ...defaults } = rpcInput.body;
    if (voiceModel != null && voiceModel !== 'web/speech-recognition') return reply({ error: 'Team voice uses browser speech recognition.' }, { status: 400 });
    const voice = { ...('voiceAutoSend' in rpcInput.body ? { voiceAutoSend } : {}), ...('voiceModel' in rpcInput.body ? { voiceModel } : {}) };
    if (Object.keys(voice).length) updateMemberPreferences(member.id, voice);
    if (Object.keys(defaults).length) {
      const { defaultHarness, defaultModel, defaultEffort } = defaults;
      updateUserState({ ...('defaultHarness' in defaults ? { defaultHarness } : {}), ...('defaultModel' in defaults ? { defaultModel } : {}), ...('defaultEffort' in defaults ? { defaultEffort } : {}) });
    }
    const preferences = getMemberPreferences(member.id);
    const row = getUserState() ?? updateUserState({});
    return reply(row ? { ...row, voiceAutoSend: preferences?.voiceAutoSend ?? null, voiceModel: preferences?.voiceModel?.startsWith('web/') ? preferences.voiceModel : 'web/speech-recognition' } : row);
  }
  try {
    const { workResultGuidance, ...settings } = rpcInput.body;
    if ('workResultGuidance' in rpcInput.body && requestHasSessionAuthority(request.headers)) {
      return reply({ error: 'Only the owner can change shared workflow guidance.', code: 'unsupported' }, { status: 403 });
    }
    const body = { ...settings, ...(workResultGuidance !== undefined ? { workResultGuidance: normalizeWorkResultGuidance(workResultGuidance) } : {}) };
    if ('executionInactiveAfterDays' in body && !isValidInactiveAfterDays(body.executionInactiveAfterDays)) {
      return reply(
        { error: `executionInactiveAfterDays must be null (default), 0 (never), or whole days up to ${MAX_INACTIVE_AFTER_DAYS}` },
        { status: 400 },
      );
    }
    const renaming = 'orchestratorName' in body;
    if (renaming) {
      if (body.orchestratorName !== null && typeof body.orchestratorName !== 'string') {
        return reply({ error: 'orchestratorName must be a string, or null for the default' }, { status: 400 });
      }
      // Stored folded to one line, and null when blank (back to the default).
      body.orchestratorName = normalizeOrchestratorName(body.orchestratorName);
      if (body.orchestratorName && body.orchestratorName.length > ORCHESTRATOR_NAME_MAX) {
        return reply(
          { error: `orchestratorName can be at most ${ORCHESTRATOR_NAME_MAX} characters` },
          { status: 400 },
        );
      }
    }
    // The look: one emoji, a palette color, an image that was really uploaded.
    const look = parseOrchestratorLook(body);
    if ('error' in look) return reply({ error: look.error }, { status: 400 });
    if (look.patch.orchestratorImage && !fs.existsSync(attachmentPath(look.patch.orchestratorImage.fileName))) {
      return reply({ error: 'orchestratorImage names a file that was never uploaded' }, { status: 400 });
    }
    Object.assign(body, look.patch);
    if (
      'orchestratorIntroducedAt' in body &&
      body.orchestratorIntroducedAt !== null &&
      (typeof body.orchestratorIntroducedAt !== 'string' || Number.isNaN(Date.parse(body.orchestratorIntroducedAt)))
    ) {
      return reply({ error: 'orchestratorIntroducedAt must be a timestamp, or null' }, { status: 400 });
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
    return reply(row);
  } catch (err) {
    if (err instanceof WorkResultGuidanceError) return reply({ error: err.message, code: err.code }, { status: 400 });
    console.error('[PATCH /api/user-state]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PATCHInput = rpcZ.object({ body: createInsertSchema(userState).pick({ "name": true, "description": true, "createdAt": true, "updatedAt": true, "activeAreaId": true, "activeParentTaskId": true, "activeEnergy": true, "availableMinutes": true, "workdayStart": true, "workdayEnd": true, "timezone": true, "voiceAutoSend": true, "usageWarnings": true, "voiceModel": true, "defaultHarness": true, "defaultModel": true, "defaultEffort": true, "monthlyBudgetUsd": true, "onboardedAt": true, "executionInactiveAfterDays": true, "orchestratorName": true, "orchestratorEmoji": true, "orchestratorColor": true, "orchestratorIntroducedAt": true }).partial().extend({ "workResultGuidance": rpcZ.unknown().optional(), "streamAutonomy": rpcZ.union([rpcZ.null(), rpcZ.object({ "killSwitch": rpcZ.boolean().optional(), "levels": rpcZ.object({ "promote_task": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "promote_note": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "merge_task": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "merge_note": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "combine_task": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "combine_note": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "journal": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "dismiss": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional(), "incubate": rpcZ.enum(["suggest", "auto_digest", "silent"]).optional() }).strict().optional() }).strict()]).optional(), "orchestratorImage": rpcZ.union([rpcZ.null(), rpcZ.object({ "fileName": rpcZ.string(), "originalName": rpcZ.string(), "mimeType": rpcZ.string(), "size": rpcZ.number().finite(), "uploadedAt": rpcZ.string() }).strict()]).optional() }).strict().default({}) }).strict();
