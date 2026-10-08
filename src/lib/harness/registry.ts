export type HarnessId = 'claude' | 'codex' | 'cursor' | 'opencode' | 'antigravity';
/**
 * Which Lucide icon stands for a harness. The registry owns the choice so every
 * surface (settings, composer, onboarding, trigger picker) draws the same one.
 * The id-to-component map lives client-side in `harness-connection-ui.tsx`.
 */
export type HarnessIconId = 'code' | 'terminal' | 'square-terminal' | 'braces' | 'orbit';

export interface HarnessCapabilities {
  sessions: boolean;
  resume: boolean;
  durableCatchUp: boolean;
  modelDiscovery: boolean;
  upstreamProviderSetup: boolean;
  upstreamProviderDisconnect: boolean;
  modelVariants: boolean;
  reasoningEffort: boolean;
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
  icon: HarnessIconId;
  installHint: string;
  loginCommand: string | null;
  docsUrl: string;
  apiKeyVar: string | null;
  resumeCommandTemplate: string | null;
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
    icon: 'code',
    installHint: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    docsUrl: 'https://developers.openai.com/codex/',
    apiKeyVar: 'OPENAI_API_KEY',
    resumeCommandTemplate: 'codex resume {id}',
    maximumCapabilities: {
      ...base,
      durableCatchUp: true,
      reasoningEffort: true,
      permissionRequests: true,
      questionRequests: true,
      planMode: true,
      modes: true,
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
    icon: 'terminal',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude login',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    apiKeyVar: 'ANTHROPIC_API_KEY',
    resumeCommandTemplate: 'claude --resume {id}',
    maximumCapabilities: {
      ...base,
      durableCatchUp: true,
      reasoningEffort: true,
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
    icon: 'square-terminal',
    installHint: 'Install the Cursor CLI from cursor.com',
    loginCommand: 'agent login',
    docsUrl: 'https://cursor.com/cli',
    apiKeyVar: 'CURSOR_API_KEY',
    resumeCommandTemplate: 'agent --resume {id}',
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
    icon: 'braces',
    installHint: 'npm install -g opencode-ai',
    loginCommand: 'opencode auth login',
    docsUrl: 'https://opencode.ai/docs/',
    apiKeyVar: null,
    resumeCommandTemplate: null,
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
    icon: 'orbit',
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
