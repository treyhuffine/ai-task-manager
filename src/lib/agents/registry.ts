export type HarnessId = 'claude' | 'codex' | 'cursor' | 'opencode';
export type AgentHarness = 'claude_code' | 'codex' | 'cursor' | 'opencode';

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
  installHint: string;
  loginCommand: string | null;
  docsUrl: string;
  apiKeyVar: string | null;
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
    installHint: 'npm install -g @anthropic-ai/claude-code',
    loginCommand: 'claude login',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    apiKeyVar: 'ANTHROPIC_API_KEY',
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
    installHint: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    docsUrl: 'https://developers.openai.com/codex/',
    apiKeyVar: 'OPENAI_API_KEY',
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
    installHint: 'Install the Cursor CLI from cursor.com',
    loginCommand: 'agent login',
    docsUrl: 'https://cursor.com/cli',
    apiKeyVar: 'CURSOR_API_KEY',
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
    installHint: 'npm install -g opencode-ai',
    loginCommand: 'opencode auth login',
    docsUrl: 'https://opencode.ai/docs/',
    apiKeyVar: null,
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

export const HARNESS_IDS = Object.freeze(Object.keys(HARNESS_REGISTRY) as HarnessId[]);

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(HARNESS_REGISTRY, value);
}

export function harnessDefinition(id: HarnessId): HarnessDefinition {
  return HARNESS_REGISTRY[id];
}

export function harnessIdForAgentRecord(value: string): HarnessId {
  const found = HARNESS_IDS.find((id) => HARNESS_REGISTRY[id].agentRecordHarness === value);
  if (!found) throw new Error(`Unknown agent harness: ${value}`);
  return found;
}
