export type AgentHarness = 'claude' | 'codex';

export interface AgentAuthReport {
  hasSubscription: boolean;
  hasApiKey: boolean;
  apiKeyVar: string | null;
  keychainUnknown: boolean;
  models: Array<{ id: string; name: string }>;
}

export interface AgentAuthState {
  phase: 'idle' | 'checking' | 'ready' | 'error';
  report?: AgentAuthReport;
  error?: string;
  /** Explicit acknowledgement that the user accepts metered API-key billing
   *  when no subscription is available. Required to leave the Agent step in
   *  the api-key-only path. */
  acceptsApiKeyBilling: boolean;
}

export interface WizardState {
  name: string;
  description: string;
  areas: Array<{ name: string; emoji: string | null; image_url: string | null }>;
  agentHarness: AgentHarness;
  agentModel: string;
  agentAuth: AgentAuthState;
  importSkipped: boolean;
}

export type StepId = 'you' | 'areas' | 'agent' | 'import' | 'launch';

export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'agent', label: 'Agent' },
  { id: 'import', label: 'Import' },
  { id: 'areas', label: 'Areas' },
  { id: 'launch', label: 'Launch' },
];
