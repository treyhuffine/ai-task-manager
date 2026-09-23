/**
 * Which entities a successful orchestrator action changed, as run artifact
 * refs. Recorded at the action layer (see `recordRunArtifacts` below, called
 * from `runAction`), where the action name, its validated input, and its real
 * return value are all in hand, and the caller's chat is known from its signed
 * session credential.
 *
 * This replaces reading refs back out of the harness's tool-result stream,
 * which never matched in practice: MCP tool names arrive prefixed
 * (`mcp__orchestrator__update_task`) and the harness hands the tool output
 * over empty, so `runs.artifactRefs` stayed empty for every run. Recording
 * where the action runs also covers the CLI path (`ri agent ...` from the
 * harness's shell), which the stream never saw.
 */

import type { RunArtifactRef } from '@/db/types';
import { appendRunArtifactRefs, findActiveRunForChatSession } from '@/lib/db/queries';

type RefExtractor = (input: Record<string, unknown>, result: unknown) => RunArtifactRef[];

function idRef(kind: RunArtifactRef['kind'], id: unknown): RunArtifactRef[] {
  return typeof id === 'string' && id.length > 0 ? [{ kind, id }] : [];
}

/** The entity is the one named by the input's `id` (updates, lifecycle commands). */
const byInputId = (kind: RunArtifactRef['kind']): RefExtractor => (input) => idRef(kind, input.id);

/** The entity is the row the action returned (creates). */
const byResultId = (kind: RunArtifactRef['kind']): RefExtractor => (_input, result) =>
  idRef(kind, (result as { id?: unknown } | null | undefined)?.id);

/**
 * Mutating actions that change one addressable task, note, or workspace.
 * Adding a mutating action that changes one of these means adding it here;
 * `artifact-refs.test.ts` checks every key names a real mutating action.
 * Actions on entities with no ref kind (areas, stream items, the deck,
 * triggers) are deliberately absent.
 */
export const ACTION_ARTIFACT_REFS: Readonly<Record<string, RefExtractor>> = {
  create_task: byResultId('task'),
  update_task: byInputId('task'),
  complete_task: byInputId('task'),
  transition_task: byInputId('task'),
  reorder_tasks: (_input, result) => {
    const changed = (result as { changedTaskIds?: unknown } | null | undefined)?.changedTaskIds;
    return Array.isArray(changed) ? changed.flatMap((id) => idRef('task', id)) : [];
  },
  create_note: byResultId('note'),
  update_note: byInputId('note'),
  create_workspace: byResultId('workspace'),
  update_workspace: byInputId('workspace'),
  archive_workspace: byInputId('workspace'),
};

/** The refs a successful action produced, or none for actions that change no addressable entity. */
export function artifactRefsForAction(
  actionName: string,
  input: Record<string, unknown>,
  result: unknown,
): RunArtifactRef[] {
  const extract = ACTION_ARTIFACT_REFS[actionName];
  return extract ? extract(input, result) : [];
}

/**
 * Attribute a successful mutating action to the run in flight in the calling
 * chat. No-op without a calling chat (a human at the CLI or in the app) or
 * without an active run (a manual chat send). Never throws: losing a ref must
 * never fail the action that already succeeded.
 */
export function recordRunArtifacts(args: {
  actionName: string;
  input: Record<string, unknown>;
  result: unknown;
  chatSessionId: string | null | undefined;
}): void {
  if (!args.chatSessionId) return;
  try {
    const refs = artifactRefsForAction(args.actionName, args.input, args.result);
    if (refs.length === 0) return;
    const run = findActiveRunForChatSession(args.chatSessionId);
    if (!run) return;
    appendRunArtifactRefs(run.id, refs);
  } catch (err) {
    console.warn(`[runs] could not record artifacts for ${args.actionName}:`, err);
  }
}
