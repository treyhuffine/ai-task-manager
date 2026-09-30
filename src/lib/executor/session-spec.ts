/**
 * Build a `SessionSpec`: everything the home decides about a chat's harness
 * session before a runner starts it (docs/homes-build.md, "P2.1 The runner
 * split"). This is the database half of what `ensureHarnessSession` did.
 * The runner adds what only its device knows.
 *
 * Orchestration sessions run in the app data root and act through the typed
 * action surface. Execution sessions fail closed on MCP and get their
 * agent's connectors, browser, instructions and reference folders. An
 * agent's main chat runs in the agent's own folder with its brief in the
 * session instructions (agent-main-chat.ts).
 */

import type { McpServerConfig, ProviderConfig } from '@agentex/agent';
import type { EffortLevel, PermissionMode, WorkspaceRecord } from '@/db/types';
import type { ResolvedReferenceFolder } from '@/db/types';
import {
  getWorkspaceSetup,
  getDevice,
  getExecution,
  getHome,
  getUserState,
  getWorkspace,
  listReferenceFoldersForWorkspace,
  type ChatPlacement,
} from '@/lib/db/queries';
import { APP_NAME } from '@/constants/app';
import type { ExecutionEnvironment, ExpectedAgentFolders } from '@/lib/runner/environment';
import {
  browserMcpServer,
  connectorsMcpServer,
  installOrchestratorSurface,
  orchestratorSessionConfig,
  renderContentFocusPrompt,
} from '@/lib/orchestrator/harness-surface';
import { resolveOrchestratorMode } from '@/lib/orchestrator/mode';
import { isBrowserEnabled } from '@/lib/browser/config';
import { listUsableReferenceFolders } from '@/lib/reference-folders/resolve';
import { buildReferenceFolderSessionConfig, referenceFolderProviderWiring } from '@/lib/reference-folders/session-config';
import { SESSION_CREDENTIAL_ENV, SESSION_CREDENTIAL_HEADER, sessionCredential } from '@/lib/orchestrator/session-credential';
import { connectorRequestsEnabled } from '@/lib/connectors/request-settings';
import { mintSessionToken } from '@/lib/auth/session-token';
import { HOME_ADDRESS_SCHEME } from '@/lib/workers/protocol';
import { harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import type { SessionSpec } from '@/lib/runner/types';
import { prepareAgentMainChatSpawn, skillDirsWriteIntoCwd } from './agent-main-chat';
import { planSessionInstructions } from './session-instructions';
import { renderSkillBuilderBrief } from '@/lib/skills/builder-brief';
import { sessionSkillExclusions } from '@/lib/skills/exclusions';
import { renderAgentInstructionsPrompt } from './prompts/agent-instructions';
import { harnessCapabilitiesOn } from './devices';
import { pendingHandoff } from '@/lib/transfer/continue';
import { handoffPreamble } from '@/lib/transfer/handoff';

/** Where the session will run. The home's own device unless a placement says otherwise. */
export type SpecTarget = Pick<ChatPlacement, 'deviceId' | 'isHome'> & { generation?: number | null };

const HOME: SpecTarget = { deviceId: '', isHome: true };

/**
 * The home's servers as a session elsewhere reaches them (P2.7): addressed
 * at the home through the worker, with the session's own token instead of
 * the home's key. Its identity rides the token, so the signed-credential
 * header goes too. A server stays in its scope (`?ws=`, `?profile=`), which
 * the proxy checks the token against.
 */
function reachedFromElsewhere(servers: McpServerConfig[], token: string): McpServerConfig[] {
  return servers.flatMap((server) => {
    if (server.type !== 'http' || !server.url) return [];
    const url = new URL(server.url);
    const headers = { ...(server.headers ?? {}) };
    delete headers[SESSION_CREDENTIAL_HEADER];
    headers.Authorization = `Bearer ${token}`;
    return [{ ...server, url: `${HOME_ADDRESS_SCHEME}${url.pathname}${url.search}`, headers }];
  });
}

/**
 * An agent's linked folders on a device, as the home records them
 * (docs/homes-spec.md §4.1): the ones with a place there. The runner checks
 * each is there when the session starts, so one the device hasn't checked
 * yet still goes.
 */
function referencesOn(workspaceId: string | null, deviceId: string): ResolvedReferenceFolder[] {
  if (!workspaceId) return [];
  const recorded = getWorkspaceSetup(workspaceId, deviceId)?.references ?? [];
  const byAlias = new Map(recorded.map((r) => [r.alias, r]));
  return listReferenceFoldersForWorkspace(workspaceId).flatMap((folder) => {
    const here = byAlias.get(folder.alias);
    if (!here?.path) return [];
    return [{ ...folder, absolutePath: here.path, exists: true, git: null, global: folder.workspaceId === null }];
  });
}

/**
 * An agent's folder and linked folders where the session runs, as the home
 * records them (docs/homes-spec.md §4.1). The runner checks each is there
 * when the session starts.
 */
function expectedAgentFolders(workspace: WorkspaceRecord, target: SpecTarget, usable: ResolvedReferenceFolder[]): ExpectedAgentFolders {
  const byAlias = new Map(usable.map((r) => [r.alias, r]));
  const setup = getWorkspaceSetup(workspace.id, target.deviceId);
  const recorded = new Map((setup?.references ?? []).map((r) => [r.alias, r]));
  return {
    homeId: getHome()?.id ?? '',
    agentId: workspace.id,
    sourceFolder: setup?.sourcePath ?? (target.isHome ? workspace.cwd : null),
    references: listReferenceFoldersForWorkspace(workspace.id).map((ref) => {
      const here = byAlias.get(ref.alias);
      const form = recorded.get(ref.alias)?.form;
      return {
        alias: ref.alias,
        description: ref.description ?? null,
        path: here?.absolutePath ?? null,
        state: here ? ('ready' as const) : form === 'omitted' ? ('omitted' as const) : form === 'unconfigured' || !form ? ('unconfigured' as const) : ('missing' as const),
      };
    }),
  };
}

/**
 * An execution's environment as the home expects it (P2.7, spec §4.3): the
 * agent, where it runs, its branch and base, its connected folders with
 * their descriptions, and its tools. Paths are the home's best knowledge
 * (its own, or the device's last report). The runner replaces them with
 * what its device's setup files say when the session starts.
 */
function expectedEnvironment(input: {
  workspace: WorkspaceRecord;
  executionId: string;
  args: SessionSpecInput;
  target: SpecTarget;
  usable: ResolvedReferenceFolder[];
  servers: McpServerConfig[];
}): ExecutionEnvironment {
  const { workspace, args, target } = input;
  const homeRow = getHome();
  const device = getDevice(target.isHome ? homeRow?.hostDeviceId ?? '' : target.deviceId);
  const execution = getExecution(input.executionId);
  const folders = expectedAgentFolders(workspace, target, input.usable);
  const urls = input.servers.map((s) => (s.type === 'http' ? s.url ?? '' : ''));
  return {
    homeId: homeRow?.id ?? '',
    homeName: homeRow?.name ?? APP_NAME,
    deviceName: device?.name ?? 'this device',
    agent: { id: workspace.id, name: workspace.name },
    executionId: input.executionId,
    isGit: workspace.isGit,
    cwd: args.cwd,
    sourceFolder: folders.sourceFolder,
    branch: execution?.branchName ?? null,
    baseBranch: workspace.baseBranch ?? null,
    baseSha: execution?.baseSha ?? null,
    references: folders.references,
    tools: { connectors: urls.some((u) => u.includes('/api/connectors/')), browser: urls.some((u) => u.includes('/browser/')) },
    harness: args.harness,
    model: args.model,
    permissionMode: args.permissionMode,
  };
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
   * (`surfaceKind` = 'task' | 'note', `surfaceRef` = its id), or the skill a
   * builder or try chat belongs to (`surfaceKind` = 'skill' | 'skill-try',
   * `surfaceRef` = its name). Null for other session types. Drives the
   * per-session focus directive, the builder brief and skill exclusions.
   */
  surfaceKind: string | null;
  surfaceRef: string | null;
  existingExternalSessionId: string | null;
  /** The execution this session works on, for its environment (P2.7). */
  executionId?: string | null;
  permissionMode: PermissionMode;
  prePlanMode: PermissionMode | null;
  model: string | null;
  modelVariant: string | null;
  effort: EffortLevel | null;
}

/** Take the provider config fields a spec carries. These are the only ones the surfaces set. */
function applyProviderConfig(spec: SessionSpec, config: Partial<ProviderConfig>): void {
  if (config.mcpServers) spec.mcpServers = [...(config.mcpServers as McpServerConfig[])];
  if (config.strictMcpConfig) spec.strictMcpConfig = true;
  if (config.disallowedTools) spec.disallowedTools = [...config.disallowedTools];
}

export async function buildSessionSpec(args: SessionSpecInput, target: SpecTarget = HOME): Promise<SessionSpec> {
  const providerType = harnessDefinition(args.harness).agentexProviderId;
  // The capabilities of the harness on the device that will run it: probed
  // here for the home's own, from its worker's report for a connected one.
  const caps = await harnessCapabilitiesOn(target, args.harness, target.isHome ? args.cwd : undefined);
  // The orchestrator, connector and browser servers are built for this home's
  // own sessions, at its localhost with its key. A session elsewhere reaches
  // them at the home's address with its own token (P2.7).
  const reachFromElsewhere = () => {
    if (spec.mcpServers.length === 0) return;
    const token = mintSessionToken({
      chatSessionId: args.chatSessionId,
      deviceId: target.deviceId,
      generation: target.generation ?? null,
    });
    spec.mcpServers = token ? reachedFromElsewhere(spec.mcpServers, token) : [];
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
      ...(target.isHome ? {} : { elsewhere: { folder: args.cwd } }),
    });
    if (!target.isHome) spec.agentFolders = expectedAgentFolders(agentMainChat, target, referencesOn(agentMainChat.id, target.deviceId));
    applyProviderConfig(spec, spawn.config);
    if (!target.isHome) reachFromElsewhere();
    spec.extraArgs.push(...spawn.extraArgs);
    spec.instructions = spawn.instructions;
    spec.firstTurnPreamble = spawn.firstTurnPreamble;
    for (const warning of spawn.warnings) {
      console.warn(`[executor] agent main chat on provider "${providerType}": ${warning}.`);
    }
  } else if ((args.sessionType === 'orchestration' || args.sessionType === 'content') && target.isHome) {
    // Install/refresh the on-disk brief (AGENTS.md, plus a CLAUDE.md pointer
    // only where Claude needs one) before spawn — this also `ensureAppRoot()`s
    // the cwd — and take the mode's typed
    // ProviderConfig slice (disallowedTools / strictMcpConfig / mcpServers).
    // Providers without tool-filtering or MCP wiring ignore the fields
    // (Codex today), so the config is safe to pass everywhere — but warn,
    // because the write guard genuinely doesn't hold there yet. The mode
    // resolves by the same rule the UI uses (lib/orchestrator/mode.ts).
    const orchestratorMode = resolveOrchestratorMode(getUserState()?.orchestratorMode);
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
      // A skill's builder chat: the brief rides the session instructions (or
      // the first message, on a harness that drops them), since unlike the
      // focus line above it's the whole job description. See
      // src/lib/skills/builder-brief.ts.
      if (args.sessionType === 'content' && args.surfaceKind === 'skill' && args.surfaceRef) {
        const brief = renderSkillBuilderBrief(args.surfaceRef);
        const plan = planSessionInstructions(providerType, [{ name: 'skill builder brief', text: brief }]);
        if (plan.text) spec.instructions = plan.text;
        if (plan.undelivered.length > 0 && !args.existingExternalSessionId) spec.firstTurnPreamble = brief;
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
      // Workspace-scoped connectors (opt-in via the workspace's connector allowlist). With none
      // allowed yet, still attached while agents may ask for connections, so the execution has
      // `request_connection` (and nothing else) when a task needs an account.
      const scopes = workspace?.connectorScopes ?? [];
      if ((scopes.length > 0 || connectorRequestsEnabled()) && args.workspaceId) {
        const connectors = connectorsMcpServer(undefined, {
          workspaceId: args.workspaceId,
          sessionId: args.chatSessionId,
        });
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
      if (!target.isHome) reachFromElsewhere();
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
    //
    // Elsewhere, the paths here are only the device's last report. The
    // runner there wires them instead, from where they resolve when the
    // session starts (`agentFolders`), so nothing here names a stale path.
    let refs: ResolvedReferenceFolder[] = [];
    try {
      refs = target.isHome
        ? await listUsableReferenceFolders(args.workspaceId ?? null, { consumerCwd: workspace?.cwd ?? null })
        : referencesOn(args.workspaceId ?? null, target.deviceId);
      if (!target.isHome) {
        if (workspace) spec.agentFolders = expectedAgentFolders(workspace, target, refs);
      } else {
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
      }
    } catch (err) {
      // A reference-folder failure must never cost the user their session.
      console.error('[executor] reference folder resolution failed:', err);
    }

    const plan = planSessionInstructions(providerType, instructionBlocks);
    if (plan.text) spec.instructions = plan.text;
    if (workspace && args.executionId) {
      spec.environment = expectedEnvironment({ workspace, executionId: args.executionId, args, target, usable: refs, servers: spec.mcpServers });
      // Continued from another device (P4.3): the fresh session there starts
      // from the handoff, on its first message.
      const handoff = pendingHandoff(args.executionId, args.existingExternalSessionId);
      if (handoff) spec.firstTurnPreamble = [spec.firstTurnPreamble, handoffPreamble(handoff)].filter(Boolean).join('\n\n');
    }
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
  // Library skills this chat doesn't get: off, limited to other agents, or
  // the one its builder is writing. Decided here because the runner may be on
  // a device without the database (src/lib/skills/reach.ts).
  try {
    const exclude = sessionSkillExclusions({
      workspaceId: args.workspaceId,
      surfaceKind: args.surfaceKind,
      surfaceRef: args.surfaceRef,
    });
    if (exclude.length > 0) spec.excludeSkills = exclude;
  } catch (err) {
    // Never cost the user their session over a skill lookup.
    console.error('[executor] skill reach lookup failed:', err);
  }

  // Every session carries its caller credential, so an orchestrator action it
  // runs (MCP header or the CLI from its shell) knows which chat is calling.
  // See src/lib/orchestrator/session-credential.ts.
  const credential = sessionCredential(args.chatSessionId);
  if (credential) spec.env[SESSION_CREDENTIAL_ENV] = credential;
  return spec;
}
