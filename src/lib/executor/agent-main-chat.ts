/**
 * Spawn preparation for an agent's main chat (docs/agents-view-spec.md
 * Phase 6): an orchestration chat with a workspace, running in the agent's
 * own folder.
 *
 * The folder belongs to the user, so nothing is written into it. The brief
 * goes through the session instructions file (in the work dir), and
 * orchestrator actions go through the session's MCP config, whatever
 * `user_state.orchestratorMode` says. The chat gets the same scope as the
 * agent's executions: its connector scopes, the agent browser when enabled,
 * and its reference folders. In a git agent the file-editing tools are
 * denied, since the checkout is what every execution's worktree branches
 * from. That guard is argv tool filtering, which only Claude enforces, so
 * elsewhere it holds by the brief alone and the caller logs it.
 *
 * Kept out of `adapter.ts` so it can be tested without spawning a harness.
 */

import type { McpServerConfig, ProviderConfig } from '@agentex/agent';
import type { WorkspaceRecord } from '@/db/types';
import {
  browserMcpServer,
  connectorsMcpServer,
  ORCHESTRATOR_DISALLOWED_TOOLS,
  orchestratorMcpServer,
  renderAgentMainChatBrief,
} from '@/lib/orchestrator/harness-surface';
import { listUsableReferenceFolders } from '@/lib/reference-folders/resolve';
import {
  buildReferenceFolderSessionConfig,
  referenceFolderProviderWiring,
} from '@/lib/reference-folders/session-config';
import { planSessionInstructions } from './session-instructions';

/** Providers that enforce argv tool filtering (`disallowedTools`). */
const TOOL_FILTER_PROVIDERS = new Set(['claude']);

export interface AgentMainChatSpawnArgs {
  chatSessionId: string;
  workspace: WorkspaceRecord;
  /** The agentex provider id (`claude`, `codex`, ...). */
  providerType: string;
  /** The harness can exclude ambient MCP config (gates connectors and browser, like executions). */
  strictMcpIsolation: boolean;
  /** The app-level agent browser switch (`isBrowserEnabled`). */
  appBrowserEnabled: boolean;
  /** No provider session to resume yet, so this spawn starts the conversation. */
  freshSession: boolean;
  port?: number;
}

export interface AgentMainChatSpawn {
  config: Partial<ProviderConfig>;
  extraArgs: string[];
  /**
   * The brief and reference-folder block as session instructions, for the
   * runner to write where the harness reads them. Null when there are none.
   */
  instructions: string | null;
  /**
   * The brief (and reference-folder block) when this harness drops session
   * instructions. Sent ahead of the first message of a fresh session so the
   * chat still knows its role. Null when the instructions file carries it.
   */
  firstTurnPreamble: string | null;
  /** Degradations worth a log line. */
  warnings: string[];
}

export async function prepareAgentMainChatSpawn(args: AgentMainChatSpawnArgs): Promise<AgentMainChatSpawn> {
  const { workspace: ws, providerType } = args;
  const warnings: string[] = [];
  const extraArgs: string[] = [];
  const disallowedTools: string[] = [];

  const servers: McpServerConfig[] = [];
  const orchestrator = orchestratorMcpServer(args.port, { sessionId: args.chatSessionId });
  if (orchestrator) servers.push(orchestrator);
  const wantsConnectors = ws.connectorScopes.length > 0;
  const connectors = wantsConnectors && args.strictMcpIsolation
    ? connectorsMcpServer(args.port, { workspaceId: ws.id })
    : null;
  if (connectors) servers.push(connectors);
  if (wantsConnectors && !args.strictMcpIsolation) {
    warnings.push('connectors are unavailable (this harness does not enforce strict MCP tool-filtering)');
  }
  // Same isolated per-workspace profile the agent's executions browse with.
  const browser = args.strictMcpIsolation && args.appBrowserEnabled && ws.browserEnabled
    ? browserMcpServer(args.port, { profile: `ws-${ws.id}` })
    : null;
  if (browser) servers.push(browser);

  if (ws.isGit) {
    disallowedTools.push(...ORCHESTRATOR_DISALLOWED_TOOLS);
    if (!TOOL_FILTER_PROVIDERS.has(providerType)) {
      warnings.push('the git write guard is prompt-only (this harness ignores tool filtering)');
    }
  }

  let referenceBlock = '';
  try {
    const refs = await listUsableReferenceFolders(ws.id, { consumerCwd: ws.cwd });
    const refConfig = buildReferenceFolderSessionConfig(refs);
    const wiring = referenceFolderProviderWiring(refConfig, providerType);
    referenceBlock = refConfig.instructions;
    extraArgs.push(...wiring.extraArgs);
    disallowedTools.push(...wiring.disallowedTools);
    if (wiring.delivery === 'prompt-only') {
      warnings.push(`${refs.length} reference folder(s) announced in the prompt, but not fenced off`);
    }
  } catch (err) {
    // A reference-folder failure must never cost the user their chat.
    warnings.push(`reference folder resolution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const blocks = [
    { name: 'agent brief', text: renderAgentMainChatBrief(ws, { connectors: !!connectors, browser: !!browser }) },
    { name: 'reference folders', text: referenceBlock },
  ];
  const plan = planSessionInstructions(providerType, blocks);
  const config: Partial<ProviderConfig> = { strictMcpConfig: true };
  if (servers.length > 0) config.mcpServers = servers;
  if (disallowedTools.length > 0) config.disallowedTools = disallowedTools;

  let firstTurnPreamble: string | null = null;
  if (plan.undelivered.length > 0) {
    const undelivered = blocks.filter((b) => plan.undelivered.includes(b.name)).map((b) => b.text.trim());
    if (args.freshSession) {
      firstTurnPreamble = undelivered.join('\n\n');
      warnings.push('this harness ignores session instructions, so the brief rides the first message instead');
    } else {
      warnings.push('this harness ignores session instructions, and a resumed chat keeps the brief it started with');
    }
  }

  return { config, extraArgs, instructions: plan.text || null, firstTurnPreamble, warnings };
}

/**
 * Providers that materialize `skillDirs` inside the session's cwd (Codex
 * symlinks them into `<cwd>/.agents/skills`, agentex 0.0.37). Claude builds a
 * temp dir and the rest use the user's home. An agent's main chat runs in the
 * user's own folder, so on these it gets no `skillDirs` rather than leaving
 * files behind.
 */
const WRITES_SKILLS_INTO_CWD = new Set(['codex']);

export function skillDirsWriteIntoCwd(providerType: string): boolean {
  return WRITES_SKILLS_INTO_CWD.has(providerType);
}

export { withFirstTurnPreamble } from '@/lib/runner/first-turn';
