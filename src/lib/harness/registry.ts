export type HarnessId = 'claude' | 'codex' | 'cursor' | 'opencode' | 'antigravity';
/**
 * Which brand mark stands for a harness: its real logo. The registry owns the
 * choice so every surface (settings, composer, onboarding, trigger picker)
 * draws the same one. The path data lives client-side in
 * `src/components/settings/harness-logo-data.ts`.
 */
export type HarnessLogoId = 'codex' | 'claude' | 'cursor' | 'opencode' | 'antigravity';

export interface HarnessCapabilities {
  sessions: boolean;
  resume: boolean;
  durableCatchUp: boolean;
  modelDiscovery: boolean;
  upstreamProviderSetup: boolean;
  upstreamProviderDisconnect: boolean;
  modelVariants: boolean;
  reasoningEffort: boolean;
  serviceTiers: boolean;
  permissionRequests: boolean;
  questionRequests: boolean;
  planMode: boolean;
  modes: boolean;
  mcp: boolean;
  strictMcpIsolation: boolean;
  concurrentSend: boolean;
  cancelQueuedMessage: boolean;
  stopTask: boolean;
  sessionModelChange: boolean;
  sessionVariantChange: boolean;
  sessionEffortChange: boolean;
  sessionModeChange: boolean;
}

export interface HarnessDefinition {
  id: HarnessId;
  agentexProviderId: HarnessId;
  /** Optional absolute executable override, persisted in service settings. */
  commandEnv: `${Uppercase<HarnessId>}_COMMAND`;
  name: string;
  description: string;
  icon: HarnessLogoId;
  installHint: string;
  loginCommand: string | null;
  docsUrl: string;
  apiKeyVar: string | null;
  resumeCommandTemplate: string | null;
  /**
   * Whether `getHarnessRuntime` asks the provider's `probeCapabilities` to
   * verify the binary and protocol. Off for Claude Code and Codex: their
   * probe (agentex 0.0.43) starts the CLI to read context and rate-limit
   * support, which availability doesn't need, and a slow start would mark
   * the whole harness unusable until the cache expires. Ri reads their rate
   * limits from chat events instead (`harness/rate-limits.ts`).
   */
  runtimeProbe: boolean;
  /**
   * Where this harness finds skills for every project (`dir`, under the home
   * folder), and whether a skill there can be a link (`links`). Ri puts its
   * shipped skills in each of these, whichever harness is the default, so one
   * switched to later already has them (`src/lib/agent-skills/shipped.ts`).
   * Checked against each CLI on 2026-10-20 and 21, with probe skills whose
   * body held a codeword: Codex, Cursor and OpenCode read `.agents/skills`
   * (Cursor and OpenCode read `.claude/skills` too), Claude Code reads only
   * `.claude/skills`, and Antigravity (agy 1.4.3) reads only
   * `.gemini/config/skills`. Claude Code and Codex use a linked skill. agy
   * lists one but, headless and without skipping permissions, is denied
   * reading it when its real folder is outside the chat's workspace, so it
   * gets copies. Cursor (CLI 2026.10.19) read a linked skill outside its
   * workspace in agentex's checks. OpenCode wasn't installed to check.
   */
  globalSkills: { dir: string; links: boolean };
  maximumCapabilities: HarnessCapabilities;
}

const base = {
  sessions: true,
  resume: true,
  durableCatchUp: false,
  modelDiscovery: false,
  upstreamProviderSetup: false,
  upstreamProviderDisconnect: false,
  modelVariants: false,
  reasoningEffort: false,
  serviceTiers: false,
  permissionRequests: false,
  questionRequests: false,
  planMode: false,
  modes: false,
  mcp: false,
  strictMcpIsolation: false,
  concurrentSend: false,
  cancelQueuedMessage: false,
  stopTask: false,
  sessionModelChange: false,
  sessionVariantChange: false,
  sessionEffortChange: false,
  sessionModeChange: false,
} satisfies HarnessCapabilities;

/** Product display order. Defaults are explicit and never inferred from an array index. */
export const HARNESS_REGISTRY: Record<HarnessId, HarnessDefinition> = {
  codex: {
    id: 'codex',
    agentexProviderId: 'codex',
    commandEnv: 'CODEX_COMMAND',
    name: 'Codex',
    description: 'OpenAI models with your ChatGPT account',
    icon: 'codex',
    installHint: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    docsUrl: 'https://developers.openai.com/codex/',
    apiKeyVar: 'OPENAI_API_KEY',
    resumeCommandTemplate: 'codex resume {id}',
    runtimeProbe: false,
    globalSkills: { dir: '.agents/skills', links: true },
    maximumCapabilities: {
      ...base,
      durableCatchUp: true,
      reasoningEffort: true,
      serviceTiers: true,
      permissionRequests: true,
      questionRequests: true,
      planMode: true,
      modes: true,
      mcp: true,
      strictMcpIsolation: true,
      concurrentSend: true,
      sessionModelChange: true,
      sessionEffortChange: true,
    },
  },
  claude: {
    id: 'claude',
    agentexProviderId: 'claude',
    commandEnv: 'CLAUDE_COMMAND',
    name: 'Claude Code',
    description: 'Anthropic models through Claude Code',
    icon: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude login',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    apiKeyVar: 'ANTHROPIC_API_KEY',
    resumeCommandTemplate: 'claude --resume {id}',
    runtimeProbe: false,
    globalSkills: { dir: '.claude/skills', links: true },
    maximumCapabilities: {
      ...base,
      durableCatchUp: true,
      reasoningEffort: true,
      serviceTiers: true,
      permissionRequests: true,
      questionRequests: true,
      planMode: true,
      mcp: true,
      strictMcpIsolation: true,
      concurrentSend: true,
      cancelQueuedMessage: true,
      stopTask: true,
      sessionModelChange: true,
      sessionEffortChange: true,
      sessionModeChange: true,
    },
  },
  cursor: {
    id: 'cursor',
    agentexProviderId: 'cursor',
    commandEnv: 'CURSOR_COMMAND',
    name: 'Cursor',
    description: 'Cursor models, including Grok when available',
    icon: 'cursor',
    installHint: 'Install the Cursor CLI from cursor.com',
    loginCommand: 'agent login',
    docsUrl: 'https://cursor.com/cli',
    apiKeyVar: 'CURSOR_API_KEY',
    resumeCommandTemplate: 'agent --resume {id}',
    runtimeProbe: true,
    globalSkills: { dir: '.agents/skills', links: true },
    maximumCapabilities: {
      ...base,
      modelDiscovery: true,
      planMode: true,
      modes: true,
    },
  },
  opencode: {
    id: 'opencode',
    agentexProviderId: 'opencode',
    commandEnv: 'OPENCODE_COMMAND',
    name: 'OpenCode',
    description: 'Models from your OpenCode providers',
    icon: 'opencode',
    installHint: 'npm install -g opencode-ai',
    loginCommand: 'opencode auth login',
    docsUrl: 'https://opencode.ai/docs/',
    apiKeyVar: null,
    resumeCommandTemplate: null,
    runtimeProbe: true,
    globalSkills: { dir: '.agents/skills', links: true },
    maximumCapabilities: {
      ...base,
      durableCatchUp: true,
      modelDiscovery: true,
      upstreamProviderSetup: true,
      upstreamProviderDisconnect: true,
      modelVariants: true,
      permissionRequests: true,
      questionRequests: true,
      planMode: true,
      modes: true,
      sessionModelChange: true,
      sessionVariantChange: true,
      sessionModeChange: true,
    },
  },
  antigravity: {
    id: 'antigravity',
    agentexProviderId: 'antigravity',
    commandEnv: 'ANTIGRAVITY_COMMAND',
    name: 'Antigravity',
    description: 'Google Gemini models through Antigravity CLI',
    icon: 'antigravity',
    installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    // There is no login subcommand: running `agy` once signs in through the
    // browser and caches the session in the OS keyring for headless runs.
    loginCommand: 'agy',
    docsUrl: 'https://antigravity.google/docs/cli/overview',
    // GEMINI_API_KEY alone does nothing. It only bills the Gemini API when
    // ~/.gemini/antigravity-cli/settings.json also selects
    // `"modelProvider": "gemini"`, so naming it here would tell users to set a
    // variable that has no effect. Agentex still reports that combination as
    // an API-key auth option, and the auth route surfaces it from there.
    apiKeyVar: null,
    // Conversations are scoped to the folder they ran in, so this resumes from
    // the chat's own working folder, like `claude --resume`.
    resumeCommandTemplate: 'agy --conversation {id}',
    runtimeProbe: true,
    globalSkills: { dir: '.gemini/config/skills', links: false },
    maximumCapabilities: {
      ...base,
      modelDiscovery: true,
      reasoningEffort: true,
      planMode: true,
      modes: true,
    },
  },
};

/** Used only when the user has not saved a harness choice. */
export const DEFAULT_HARNESS: HarnessId = 'codex';

const ALL_HARNESS_IDS = Object.freeze(Object.keys(HARNESS_REGISTRY) as [HarnessId, ...HarnessId[]]);

/** Every harness this build knows, rollout flag or not. Stored rows may name any of them. */
export const KNOWN_HARNESS_IDS = ALL_HARNESS_IDS;

/**
 * Emergency rollout switches. Every harness added after Claude and Codex ships
 * enabled, and the exact string `false` hides it and makes dispatch refuse it.
 * Each variable is spelled out in full because Next inlines `NEXT_PUBLIC_*`
 * only for literal property reads, which keeps browser and server agreeing.
 */
export function isHarnessEnabled(id: HarnessId): boolean {
  switch (id) {
    case 'cursor':
      return process.env.NEXT_PUBLIC_RI_CURSOR_ENABLED !== 'false';
    case 'opencode':
      return process.env.NEXT_PUBLIC_RI_OPENCODE_ENABLED !== 'false';
    case 'antigravity':
      return process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED !== 'false';
    case 'claude':
    case 'codex':
      return true;
  }
}

export class HarnessDisabledError extends Error {
  constructor(id: HarnessId) {
    super(`${id} is disabled by the rollout configuration`);
    this.name = 'HarnessDisabledError';
  }
}

/** Launch/creation guard. Reading stored metadata must use the known-id helpers. */
export function assertHarnessEnabled(id: HarnessId): void {
  if (!isHarnessEnabled(id)) throw new HarnessDisabledError(id);
}

export const HARNESS_IDS = Object.freeze(ALL_HARNESS_IDS.filter(isHarnessEnabled));

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(HARNESS_REGISTRY, value)
    && HARNESS_IDS.includes(value as HarnessId);
}

export function harnessDefinition(id: HarnessId): HarnessDefinition {
  return HARNESS_REGISTRY[id];
}

/**
 * True for any harness this build knows, including ones a rollout flag has
 * switched off. Stored rows (chats, triggers, runs) are checked against this
 * rather than `isHarnessId`, so history on a disabled harness still reads.
 */
export function isKnownHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HARNESS_REGISTRY, value);
}

export function resumeCommandForHarness(
  harness: string | null,
  externalSessionId: string | null,
): string | null {
  if (!harness || !externalSessionId || !isKnownHarnessId(harness)) return null;
  const template = HARNESS_REGISTRY[harness].resumeCommandTemplate;
  return template?.replace('{id}', externalSessionId) ?? null;
}

/** Registry-level explanations for the controls each harness can expose. */
const CAPABILITY_LABELS: Record<keyof HarnessCapabilities, string> = {
  sessions: 'chat sessions', resume: 'resuming a saved chat', durableCatchUp: 'recovering durable chat history',
  modelDiscovery: 'discovering models', upstreamProviderSetup: 'configuring upstream providers', upstreamProviderDisconnect: 'disconnecting upstream providers',
  modelVariants: 'model variants', reasoningEffort: 'reasoning effort', serviceTiers: 'provider speed controls', permissionRequests: 'approval prompts', questionRequests: 'interactive questions',
  planMode: 'planning mode', modes: 'session modes', mcp: 'session tools', strictMcpIsolation: 'restricting tools to the supplied MCP configuration',
  concurrentSend: 'sending another message during a turn', cancelQueuedMessage: 'cancelling a message already queued inside the harness', stopTask: 'stopping an individual background task',
  sessionModelChange: 'changing models in a live chat', sessionVariantChange: 'changing variants in a live chat', sessionEffortChange: 'changing effort in a live chat', sessionModeChange: 'changing modes in a live chat',
};
const CAPABILITY_REASONS: Partial<Record<HarnessId, Partial<Record<keyof HarnessCapabilities, string>>>> = {
  opencode: { strictMcpIsolation: 'OpenCode can use its own configured MCP tools. This adapter does not supply a restricted MCP configuration.' },
  cursor: { permissionRequests: 'Cursor uses its CLI permission policy and does not send approval prompts to Ri.', questionRequests: 'Cursor does not expose interactive questions to Ri.', strictMcpIsolation: 'Cursor can use its own configured MCP tools in addition to the tools Ri supplies.' },
  antigravity: { permissionRequests: 'Antigravity uses its CLI permission policy and does not send approval prompts to Ri.', questionRequests: 'Antigravity does not expose interactive questions to Ri.', strictMcpIsolation: 'Antigravity can use its own configured MCP tools in addition to the tools Ri supplies.' },
};
export function harnessCapabilityReason(harness: HarnessId, capability: keyof HarnessCapabilities): string {
  return CAPABILITY_REASONS[harness]?.[capability] ?? `${HARNESS_REGISTRY[harness].name} does not expose ${CAPABILITY_LABELS[capability]} to Ri.`;
}
