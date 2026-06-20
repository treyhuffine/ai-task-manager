'use client';

import { useState } from 'react';
import { FilePenLine } from 'lucide-react';
import { EntityDiffModal } from './entity-diff-modal';

/**
 * Inline transcript chip rendered for the agent's `update_task`/`update_note`
 * tool calls in the in-document chat. Opens a diff modal showing exactly what
 * the change did, with a one-tap undo. The chat applies edits optimistically
 * ("assume it's right"); this is the human's review + revert handle.
 */
export function EntityEditChip({
  entityType,
  entityId,
}: {
  entityType: 'task' | 'note';
  entityId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex min-w-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-px text-[10.5px] font-medium text-primary hover:bg-primary/20 transition-colors"
        title="Review this change"
      >
        <FilePenLine size={10} className="flex-shrink-0" />
        <span>Edited {entityType} · view changes</span>
      </button>
      {open && (
        <EntityDiffModal
          open={open}
          onClose={() => setOpen(false)}
          entityType={entityType}
          entityId={entityId}
        />
      )}
    </>
  );
}

/**
 * Detect an agent entity-edit tool call (`update_task`/`update_note`, bare or
 * MCP-namespaced like `mcp__orchestrator__update_note`) and pull the target
 * id out of its input. Returns null for anything else.
 */
export function parseEntityEditTool(
  toolName: string | null | undefined,
  toolInput: unknown,
): { entityType: 'task' | 'note'; entityId: string } | null {
  if (!toolName) return null;
  const m = /update_(task|note)$/.exec(toolName);
  if (!m) return null;
  let input = toolInput;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!input || typeof input !== 'object') return null;
  const id = (input as Record<string, unknown>).id;
  if (typeof id !== 'string' || !id) return null;
  return { entityType: m[1] as 'task' | 'note', entityId: id };
}
