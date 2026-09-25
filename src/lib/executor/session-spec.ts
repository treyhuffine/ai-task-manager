/**
 * Build a `SessionSpec`: everything the home decides about a chat's harness
 * session before a runner starts it (docs/homes-build.md, "P2.1 The runner
 * split"). This is the database half of what `ensureHarnessSession` did.
 * The runner adds what only its computer knows.
 *
 * Orchestration sessions run in the app data root and act through the typed
 * action surface. Execution sessions fail closed on MCP and get their
 * agent's connectors, browser, instructions and reference folders. An
 * agent's main chat runs in the agent's own folder with its brief in the
 * session instructions (agent-main-chat.ts).
 */

import type { McpServerConfig, ProviderConfig } from '@agentex/agent';
import type { EffortLevel, PermissionMode } from '@/db/types';
import type { ResolvedReferenceFolder } from '@/db/types';
import { getAgentSetup, getUserState, getWorkspace, listReferenceFoldersForWorkspace, type ChatPlacement } from '@/lib/db/queries';
import {
  browserMcpServer,
  connectorsMcpServer,
  installOrchestratorSurface,
  orchestratorSessionConfig,
  renderContentFocusPrompt,
  type OrchestratorMode,
} from '@/lib/orchestrator/harness-surface';
import { isBrowserEnabled } from '@/lib/browser/config';
import { listUsableReferenceFolders } from '@/lib/reference-folders/resolve';
import { buildReferenceFolderSessionConfig, referenceFolderProviderWiring } from '@/lib/reference-folders/session-config';
import { SESSION_CREDENTIAL_ENV, sessionCredential } from '@/lib/orchestrator/session-credential';
import { harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import type { SessionSpec } from '@/lib/runner/types';
import { prepareAgentMainChatSpawn, skillDirsWriteIntoCwd } from './agent-main-chat';
import { planSessionInstructions } from './session-instructions';
import { renderAgentInstructionsPrompt } from './prompts/agent-instructions';
import { harnessCapabilitiesOn } from './computers';

/** Where the session will run. The home's own computer unless a placement says otherwise. */
export type SpecTarget = Pick<ChatPlacement, 'computerId' | 'isHome'>;

const HOME: SpecTarget = { computerId: '', isHome: true };

/**
 * An agent's reference folders as a connected computer resolved them from
 * its own setup file: the alias and description from the home, the path
 * from that computer's last report. Only the ones that exist there.
 */
function referencesOn(workspaceId: string | null, computerId: string): ResolvedReferenceFolder[] {
  if (!workspaceId) return [];
  const reported = getAgentSetup(workspaceId, computerId)?.references ?? [];
  const byAlias = new Map(reported.map((r) => [r.alias, r]));
  return listReferenceFoldersForWorkspace(workspaceId).flatMap((folder) => {
    const here = byAlias.get(folder.alias);
    if (!here?.path || !here.exists) return [];
    return [{ ...folder, absolutePath: here.path, exists: true, git: null, global: folder.workspaceId === null }];
  });
}

export interface SessionSpecInput {
  chatSessionId: string;
  harness: HarnessId;
  cwd: string;
  /** chat_sessions.type — orchestration sessions get the data-root surface. */
  sessionType: 'orchestration' | 'content' | 'execution';
  /** The session's workspace (for execution connector scoping); null for workspace-less. */
  workspaceId: string | null;
  /**
   * For `content` sessions: the entity the in-document chat is focused on
   * (`surfaceKind` = 'task' | 'note', `surfaceRef` = its id). Null for other
   * session types. Drives the per-session focus directive.
   */
  surfaceKind: string | null;
  surfaceRef: string | null;
  existingExternalSessionId: string | null;
  permissionMode: PermissionMode;
  prePlanMode: PermissionMode | null;
  model: string | null;
  modelVariant: string | null;
  effort: EffortLevel | null;
}

/**
 * Which orchestrator surface an orchestration-type session gets. The
 * dashboard toggle (`user_state.orchestratorMode`) wins when it names a
 * harness mode; `legacy` (the hand-rolled chat agent) still needs scheduled
 * orchestrator fires to work, and those are harness sessions by
 * construction — they default to the MCP surface, the most robust path.
 */
function resolveOrchestratorMode(): Exclude<OrchestratorMode, 'legacy'> {
  const mode = getUserState()?.orchestratorMode;
  return mode === 'harness_skills' || mode === 'harness_mcp' ? mode : 'harness_mcp';
}

/** Take the provider config fields a spec carries. These are the only ones the surfaces set. */
function applyProviderConfig(spec: SessionSpec, config: Partial<ProviderConfig>): void {
  if (config.mcpServers) spec.mcpServers = [...(config.mcpServers as McpServerConfig[])];
  if (config.strictMcpConfig) spec.strictMcpConfig = true;
  if (config.disallowedTools) spec.disallowedTools = [...config.disallowedTools];
}

export async function buildSessionSpec(args: SessionSpecInput, target: SpecTarget = HOME): Promise<SessionSpec> {
  const providerType = harnessDefinition(args.harness).agentexProviderId;
  // The capabilities of the harness on the computer that will run it: probed
  // here for the home's own, from its worker's report for a connected one.
  const caps = await harnessCapabilitiesOn(target, args.harness, target.isHome ? args.cwd : undefined);
  // The orchestrator, connector and browser servers are addressed at this
  // home's localhost with its own token, so a session elsewhere can't reach
  // them. P2.7 gives those sessions the home's address and their own token.
  const dropHomeServers = (why: string) => {
    if (spec.mcpServers.length === 0) return;
    console.warn(`[executor] ${why} on a connected computer: ${spec.mcpServers.length} MCP server(s) not attached until they can reach the home.`);
    spec.mcpServers = [];
  };

  const spec: SessionSpec = {
    chatSessionId: args.chatSessionId,
    harness: args.harness,
    cwd: args.cwd,
    sessionType: args.sessionType,
    nativeSessionId: args.existingExternalSessionId,
    permissionMode: args.permissionMode,
    prePlanMode: args.prePlanMode,
    model: args.model,
    modelVariant: args.modelVariant,
    effort: args.effort,
    mcpServers: [],
    strictMcpConfig: false,
    disallowedTools: [],
    extraArgs: [],
    instructions: null,
    firstTurnPreamble: null,
    env: {},
    attachUserSkills: true,
    cleanLegacySkillLinks: args.sessionType === 'execution',
  };

  // An agent's main chat: an orchestration chat with a workspace, running in
  // the user's own folder. Nothing is installed there, whatever the
  // orchestrator mode says: the brief rides the session instructions file and
  // the actions come over the session's MCP config. See agent-main-chat.ts.
  const agentMainChat = args.sessionType === 'orchestration' && args.workspaceId
    ? getWorkspace(args.workspaceId) ?? null
    : null;
  if (agentMainChat) {
    const spawn = await prepareAgentMainChatSpawn({
      chatSessionId: args.chatSessionId,
      workspace: agentMainChat,
      providerType,
      strictMcpIsolation: caps.strictMcpIsolation,
      appBrowserEnabled: isBrowserEnabled(),
      freshSession: !args.existingExternalSessionId,
    });
    applyProviderConfig(spec, spawn.config);
    if (!target.isHome) dropHomeServers('agent main chat');
    spec.extraArgs.push(...spawn.extraArgs);
    spec.instructions = spawn.instructions;
    spec.firstTurnPreamble = spawn.firstTurnPreamble;
    for (const warning of spawn.warnings) {
      console.warn(`[executor] agent main chat on provider "${providerType}": ${warning}.`);
    }
  } else if ((args.sessionType === 'orchestration' || args.sessionType === 'content') && target.isHome) {
    // Install/refresh the on-disk brief (CLAUDE.md / AGENTS.md) before spawn —
    // this also `ensureAppRoot()`s the cwd — and take the mode's typed
    // ProviderConfig slice (disallowedTools / strictMcpConfig / mcpServers).
    // Providers without tool-filtering or MCP wiring ignore the fields
    // (Codex today), so the config is safe to pass everywhere — but warn,
    // because the write guard genuinely doesn't hold there yet.
    const orchestratorMode = resolveOrchestratorMode();
    try {
      await installOrchestratorSurface(orchestratorMode);
      applyProviderConfig(spec, orchestratorSessionConfig(orchestratorMode, { sessionId: args.chatSessionId }));
      // A `content` session is a *focused* orchestrator session: same
      // installed surface + tool set, narrowed to the one task/note the user
      // is viewing in the editor. The focus rides Claude's
      // --append-system-prompt so it never shows in the transcript; other
      // providers run the un-focused surface (the brief + the user's own
      // messages still keep them on-task — no write guard either way there).
      if (
        args.sessionType === 'content' &&
        providerType === 'claude' &&
        (args.surfaceKind === 'task' || args.surfaceKind === 'note') &&
        args.surfaceRef
      ) {
        spec.extraArgs.push(
          '--append-system-prompt',
          renderContentFocusPrompt({ entityType: args.surfaceKind, entityId: args.surfaceRef }),
        );
      }
      if (providerType !== 'claude') {
        console.warn(
          `[executor] ${args.sessionType} session on provider "${providerType}": surface installed, ` +
            'but tool filtering / MCP attachment are ignored by this provider (no write guard).',
        );
      }
    } catch (err) {
      // A failed surface install shouldn't kill the turn — the session
      // still runs against whatever brief is already on disk.
      console.error('[executor] orchestrator surface install failed:', err);
    }
  }

  // Execution (workspace coding/agent) sessions: fail closed on MCP, and attach the
  // workspace-scoped connectors endpoint when the workspace opted in — but ONLY on a harness that
  // actually enforces strict MCP (Claude Code today; Codex ignores these fields). See spec §3/§6c.
  if (args.sessionType === 'execution') {
    const workspace = args.workspaceId ? getWorkspace(args.workspaceId) ?? null : null;
    if (caps.strictMcpIsolation) {
      spec.strictMcpConfig = true; // no ambient/user/repo MCP leaks into the worktree agent
      const servers: McpServerConfig[] = [];
      // Workspace-scoped connectors (opt-in via the workspace's connector allowlist).
      const scopes = workspace?.connectorScopes ?? [];
      if (scopes.length > 0 && args.workspaceId) {
        const connectors = connectorsMcpServer(undefined, { workspaceId: args.workspaceId });
        if (connectors) servers.push(connectors);
      }
      // Agent browser, when the app allows it AND the workspace opted in (default
      // on). Executions browse an ISOLATED per-workspace profile so an autonomous
      // run cannot reach the user's logged-in default identity. The profile is
      // forced by the browser MCP route, the execution cannot switch it.
      const browserOn = isBrowserEnabled() && (workspace ? workspace.browserEnabled : true);
      if (browserOn) {
        const profile = args.workspaceId ? `ws-${args.workspaceId}` : 'execution';
        const browser = browserMcpServer(undefined, { profile });
        if (browser) servers.push(browser);
      }
      if (servers.length > 0) spec.mcpServers = servers;
      if (!target.isHome) dropHomeServers('execution');
    } else if ((workspace?.connectorScopes.length ?? 0) > 0) {
      console.warn(
        `[executor] execution on provider "${providerType}": connectors are unavailable ` +
          '(this harness does not enforce strict MCP tool-filtering).',
      );
    }

    // Session instructions: agentex takes one `instructionsFile`, so every
    // block an execution is told at spawn goes into it, in this order. First
    // the agent's standing instructions (docs/agents-view-spec.md Phase 3),
    // then the reference-folder block below.
    const instructionBlocks = [
      { name: 'agent instructions', text: workspace ? renderAgentInstructionsPrompt(workspace) : '' },
    ];

    // Reference folders (docs/reference-folders-spec.md §6/§7). The prompt
    // block is the feature — the agent can already read any absolute path, it
    // just never knows the folder is there. Delivered via `instructionsFile`
    // because every provider resolves that, unlike the claude-only
    // `--append-system-prompt` used by the content branch above.
    //
    // `--add-dir` and the Edit deny rules are claude-only argv, so they're
    // gated. Broken references are dropped upstream by
    // `listUsableReferenceFolders` — pointing an agent at a path that isn't
    // there is worse than saying nothing.
    try {
      const refs = target.isHome
        ? await listUsableReferenceFolders(args.workspaceId ?? null, { consumerCwd: workspace?.cwd ?? null })
        : referencesOn(args.workspaceId ?? null, target.computerId);
      const refConfig = buildReferenceFolderSessionConfig(refs);
      if (refConfig.instructions) {
        const wiring = referenceFolderProviderWiring(refConfig, providerType);
        if (wiring.deliversInstructions) {
          instructionBlocks.push({ name: 'reference folders', text: refConfig.instructions });
        }
        spec.extraArgs.push(...wiring.extraArgs);
        if (wiring.disallowedTools.length > 0) spec.disallowedTools.push(...wiring.disallowedTools);
        if (wiring.delivery === 'prompt-only') {
          console.warn(
            `[executor] execution on provider "${providerType}": ${refs.length} reference folder(s) ` +
              'announced in the prompt, but the read scope and edit deny rules are claude-only argv ' +
              '(this provider is told about them without being fenced off).',
          );
        } else if (wiring.delivery === 'unsupported') {
          // Not a partial degradation — a total one. This provider's session
          // path drops `instructionsFile`, so the agent is never told the
          // folders exist, which is the whole feature.
          console.warn(
            `[executor] execution on provider "${providerType}": ${refs.length} reference folder(s) ` +
              'configured but NOT delivered — this harness ignores session-scoped instructions, ' +
              'so the agent will not be told these folders exist. Use claude or codex for reference folders.',
          );
        }
      }
    } catch (err) {
      // A reference-folder failure must never cost the user their session.
      console.error('[executor] reference folder resolution failed:', err);
    }

    const plan = planSessionInstructions(providerType, instructionBlocks);
    if (plan.text) spec.instructions = plan.text;
    // Reference folders report their own delivery above. Agent instructions
    // are reported here, and the same way: a total loss, not a degradation.
    if (plan.undelivered.includes('agent instructions')) {
      console.warn(
        `[executor] execution on provider "${providerType}": agent instructions configured but NOT ` +
          'delivered — this harness ignores session-scoped instructions, so the agent will not see ' +
          'them. Use claude or codex for agent instructions.',
      );
    }
  }

  // An agent's main chat runs in the user's own folder, so it gets no user
  // skills on a harness that would write them there.
  spec.attachUserSkills = !(agentMainChat && skillDirsWriteIntoCwd(providerType));

  // Every session carries its caller credential, so an orchestrator action it
  // runs (MCP header or the CLI from its shell) knows which chat is calling.
  // See src/lib/orchestrator/session-credential.ts.
  const credential = sessionCredential(args.chatSessionId);
  if (credential) spec.env[SESSION_CREDENTIAL_ENV] = credential;
  return spec;
}
