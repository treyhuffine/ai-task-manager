import type { ChatEventRecord } from '@/db/types';
import { isSubagentTool } from '@/lib/executions/tool-display';

/**
 * Nested-actor attribution for transcript events.
 *
 * Claude Code streams a subagent's *own* events — its assistant text, its
 * thinking, its tool calls and results — onto the parent session's stream,
 * each tagged with the `tool_use` id of the `Agent`/`Task` call that launched
 * it. They are not the session talking to the user; they are a child talking
 * to its caller.
 *
 * This mirrors Claude Code's own on-disk model, where a subagent gets its own
 * transcript at `<session>/subagents/agent-<taskId>.jsonl` and the parent
 * transcript contains none of its messages. Grouping the tagged rows by
 * `externalParentToolCallId` reconstructs that file exactly — verified
 * against a real session: 5 assistant / 3 thinking / 10 tool calls / 10 tool
 * results on both sides.
 *
 * Untagged, those rows are indistinguishable from the main agent's reply,
 * which is what made a session's visible answer churn through every
 * subagent's narration and re-mark itself unread on each line.
 *
 * **The tag alone does not mean "subagent".** Claude puts a
 * `parent_tool_use_id` on anything nested under any tool call. In the real
 * corpus only 8,453 of ~13,000 tagged rows hang off an `Agent`; the rest hang
 * off `Bash` (progress heartbeats), `Skill`, and `TaskOutput`. A Skill's tool
 * calls are the session's own work, just scoped — folding those away would
 * hide up to 74 shell commands behind a disclosure and report them as "1 tool
 * call". So nesting is gated on the parent being a genuine subagent launch.
 */

/** Minimal shape needed to attribute an event — works for records and DTOs. */
export type AttributableEvent = Pick<ChatEventRecord, 'externalParentToolCallId'>;

/** Adds what's needed to find and qualify the tool call an event hangs off. */
export type AnchorableEvent = AttributableEvent &
  Pick<ChatEventRecord, 'source' | 'toolName' | 'externalToolCallId'>;

/**
 * True when the event carries a nested-actor tag at all.
 *
 * Deliberately broader than "is a subagent event": callers use this to decide
 * whether a row may stand in as the session's own reply, and the answer is no
 * for anything nested, subagent or not.
 */
export function isSubagentEvent(event: AttributableEvent): boolean {
  return Boolean(event.externalParentToolCallId);
}

/** True when this row is a tool call that can own a nested transcript. */
export function isSubagentLaunch(event: AnchorableEvent): boolean {
  return event.source === 'tool_call' && isSubagentTool(event.toolName);
}

export interface PartitionedEvents<T> {
  /**
   * Everything that renders in the main flow, in original order: the
   * session's own events, plus any nested event that has no reachable
   * subagent launch to render inside (see the anchor rule below).
   */
  topLevel: T[];
  /**
   * Subagent events keyed by the `tool_use` id that launched them, each list
   * in original order. A depth-2 subagent keys off its *immediate* parent
   * call, so the map forms a tree rather than flattening every descendant
   * onto the outermost launch.
   */
  byParentCallId: Map<string, T[]>;
}

/**
 * Split a chronological event list into the main flow and the nested
 * transcripts hanging off each subagent launch.
 *
 * **The anchor rule.** A nested event is only pulled out of the main flow
 * when its launching `Agent` call is present *and reachable* — i.e. that call
 * itself renders, either at the top level or inside another reachable launch.
 * Nesting is drawn inside the launch row, so an unreachable anchor means
 * there is nowhere to draw the children and they would silently vanish.
 *
 * That is not hypothetical: the transcript paginates. Measured on real
 * sessions, a page can hold 375 subagent events whose `Agent` launch rows sit
 * on an older page that hasn't loaded yet. Those events stay inline until the
 * launch row loads, then re-nest automatically. Rendering them unattributed
 * is a cosmetic imperfection; dropping them is data loss.
 *
 * Order is preserved throughout, so callers can render the main transcript
 * unchanged and expand any launch into a faithful child transcript.
 */
export function partitionSubagentEvents<T extends AnchorableEvent>(
  events: readonly T[],
): PartitionedEvents<T> {
  // Candidate anchors: every subagent launch that carries a call id.
  const candidates = new Map<string, T>();
  for (const event of events) {
    if (!isSubagentLaunch(event) || !event.externalToolCallId) continue;
    candidates.set(event.externalToolCallId, event);
  }

  // A row naming itself as its own parent can only render inside itself, so
  // its self-edge is ignored — but the row still renders at the top level and
  // can still own its other children.
  const selfParented = (e: T) =>
    e.externalParentToolCallId !== null &&
    e.externalParentToolCallId === e.externalToolCallId;

  // Keep only anchors that actually render. A launch nested under another
  // launch is fine — it renders inside its parent — but one nested under a
  // parent that never renders (a cycle, or a chain rooted outside the page)
  // is unreachable, and so are its children. Walk down from the roots.
  const reachable = new Set<string>();
  const roots: T[] = [];
  for (const anchor of candidates.values()) {
    const parent = anchor.externalParentToolCallId;
    if (!parent || selfParented(anchor) || !candidates.has(parent)) roots.push(anchor);
  }
  const queue = roots.slice();
  while (queue.length) {
    const anchor = queue.shift()!;
    const callId = anchor.externalToolCallId!;
    if (reachable.has(callId)) continue;
    reachable.add(callId);
    for (const child of candidates.values()) {
      if (child.externalParentToolCallId === callId) queue.push(child);
    }
  }

  const topLevel: T[] = [];
  const byParentCallId = new Map<string, T[]>();

  for (const event of events) {
    const parentCallId = event.externalParentToolCallId;
    if (!parentCallId || selfParented(event) || !reachable.has(parentCallId)) {
      topLevel.push(event);
      continue;
    }
    const siblings = byParentCallId.get(parentCallId);
    if (siblings) siblings.push(event);
    else byParentCallId.set(parentCallId, [event]);
  }

  return { topLevel, byParentCallId };
}

/**
 * Every event nested under `callId`, transitively — the launch's own children
 * plus everything their nested launches produced.
 *
 * Turn-level aggregates (the file footer, activity counts) describe what
 * happened during a turn, and a subagent writing a file still changed that
 * file. Walking only the immediate bucket under-reports a fan-out by the
 * whole grandchild subtree.
 */
export function collectNestedEvents<T extends AnchorableEvent>(
  callId: string,
  byParentCallId: ReadonlyMap<string, T[]>,
  seen: Set<string> = new Set(),
): T[] {
  if (seen.has(callId)) return [];
  seen.add(callId);
  const out: T[] = [];
  for (const event of byParentCallId.get(callId) ?? []) {
    out.push(event);
    if (isSubagentLaunch(event) && event.externalToolCallId) {
      out.push(...collectNestedEvents(event.externalToolCallId, byParentCallId, seen));
    }
  }
  return out;
}
