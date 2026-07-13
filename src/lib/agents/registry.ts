export type HarnessId = 'claude' | 'codex' | 'cursor' | 'opencode';
export type AgentHarness = 'claude_code' | 'codex' | 'cursor' | 'opencode';
export type HarnessIconId = 'sparkles' | 'code' | 'terminal' | 'braces';

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
  agentRecordHarness: AgentHarness;
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

export const HARNESS_REGISTRY: Record<HarnessId, HarnessDefinition> = {
  claude: {
    id: 'claude',
    agentexProviderId: 'claude',
    agentRecordHarness: 'claude_code',
    name: 'Claude Code',
    description: 'Anthropic models through Claude Code',
    icon: 'sparkles',
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
  codex: {
    id: 'codex',
    agentexProviderId: 'codex',
    agentRecordHarness: 'codex',
    name: 'Codex',
    description: 'OpenAI models through Codex',
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
  cursor: {
    id: 'cursor',
    agentexProviderId: 'cursor',
    agentRecordHarness: 'cursor',
    name: 'Cursor',
    description: 'Cursor models, including Grok when available',
    icon: 'terminal',
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
    agentRecordHarness: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode with your configured upstream providers',
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
};

const ALL_HARNESS_IDS = Object.freeze(Object.keys(HARNESS_REGISTRY) as HarnessId[]);

/** Emergency rollout switches. Both new harnesses ship enabled by default. */
export function isHarnessEnabled(id: HarnessId): boolean {
  if (id === 'cursor') return process.env.NEXT_PUBLIC_FLOW_CURSOR_ENABLED !== 'false';
  if (id === 'opencode') return process.env.NEXT_PUBLIC_FLOW_OPENCODE_ENABLED !== 'false';
  return true;
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

export function harnessIdForAgentRecord(value: string): HarnessId {
  // Accept the provider vocabulary too. Older databases stored `claude`
  // directly while newer agent rows use the descriptive `claude_code` key.
  if (isHarnessId(value)) return value;
  const found = ALL_HARNESS_IDS.find((id) => HARNESS_REGISTRY[id].agentRecordHarness === value);
  if (!found) throw new Error(`Unknown agent harness: ${value}`);
  return found;
}

export function resumeCommandForHarness(
  harness: string | null,
  externalSessionId: string | null,
): string | null {
  if (!harness || !externalSessionId) return null;
  try {
    const template = HARNESS_REGISTRY[harnessIdForAgentRecord(harness)].resumeCommandTemplate;
    return template?.replace('{id}', externalSessionId) ?? null;
  } catch {
    return null;
  }
}
