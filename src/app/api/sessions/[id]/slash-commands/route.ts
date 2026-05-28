import type { NextRequest } from 'next/server';
import {
  discoverSkillCommands,
  reconcileSkillCommands,
  type SkillCommandDescriptor,
} from '@agentex/agent';
import { getChatSession, getAgent } from '@/lib/db/queries';
import { mapHarnessToProvider } from '@/lib/executor/harness';
import { getAppRoot } from '@/lib/config/paths';
import * as executor from '@/lib/executor/adapter';

/**
 * Merge agentex's local skill discovery with the live runtime inventory
 * captured from the provider's `system/init` event, then return the
 * descriptors the slash menu should offer.
 *
 * Two filters at the boundary:
 *   - `userInvocable !== false` — hides skills the author flagged as
 *     model-only.
 *   - `available !== false` — for Claude, this hides skills that didn't
 *     appear in `system/init.skills` / `slash_commands`. For other
 *     providers it's a no-op (reconcile passes them through).
 *
 * Discovery scans both:
 *   - User-level: `~/.claude/skills/` and `~/.agents/skills/` (skills the
 *     user shares across all their agents — same set Claude Code's own
 *     ancestor walk picks up).
 *   - Workspace-level: `<app-root>/.claude/skills/` and
 *     `<app-root>/.agents/skills/` (where `<cli> skills install`
 *     symlinks the skills shipped with this app).
 * `includeInstalled: 'all'` covers both. No filesystem watcher — the
 * result is re-fetched per request via TanStack Query.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = getChatSession(id);
  if (!session) {
    return Response.json({ error: 'session not found' }, { status: 404 });
  }

  const agent = getAgent(session.agentId);
  if (!agent) {
    return Response.json({ error: 'agent not found' }, { status: 404 });
  }

  const provider = mapHarnessToProvider(agent.harness);

  const { commands, diagnostics } = await discoverSkillCommands({
    cwd: getAppRoot(),
    includeInstalled: 'all',
    runtime: provider,
  });

  const reconciled = reconcileSkillCommands({
    discovered: commands,
    inventory: executor.getSessionInventory(id),
    provider,
  });

  const visible = reconciled.filter(
    (cmd: SkillCommandDescriptor) => cmd.userInvocable !== false && cmd.available !== false,
  );

  return Response.json({
    commands: visible,
    diagnostics,
    inventorySource: executor.getSessionInventory(id)?.source ?? 'none',
  });
}
