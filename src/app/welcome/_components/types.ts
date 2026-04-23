import type { AgentAuthResponse } from '@/app/api/agent/auth/route';
import type { AgentVerifyResponse } from '@/app/api/agent/verify/route';
import type { Attachment } from '@/db/types';

export type AgentHarness = 'claude' | 'codex';

/** Wire shape returned by /api/agent/auth — imported so client and server
 *  share a single source of truth. */
export type AgentAuthReport = AgentAuthResponse;

export interface AgentVerifyState {
  phase: 'idle' | 'running' | 'ok' | 'failed' | 'skipped';
  result?: AgentVerifyResponse;
  error?: string;
}

export interface AgentAuthState {
  phase: 'idle' | 'checking' | 'ready' | 'error';
  report?: AgentAuthReport;
  error?: string;
  /** Real round-trip verification that follows the fast auth check. Runs
   *  automatically once auth reports a usable path so the user can't reach
   *  the next step without confirming the agent actually responds. */
  verify: AgentVerifyState;
  /** Explicit acknowledgement that the user accepts metered API-key billing
   *  when no subscription is available. Required to leave the Agent step in
   *  the api-key-only path. */
  acceptsApiKeyBilling: boolean;
}

export interface WizardState {
  name: string;
  description: string;
  areas: Array<{ name: string; emoji: string | null; attachments: Attachment[] }>;
  agentHarness: AgentHarness;
  agentAuth: AgentAuthState;
  importSkipped: boolean;
}

export type StepId = 'you' | 'areas' | 'agent' | 'import' | 'launch';

export type WizardUpdate = (
  patch: Partial<WizardState> | ((s: WizardState) => Partial<WizardState>),
) => void;

export const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'you', label: 'You' },
  { id: 'agent', label: 'Agent' },
  { id: 'import', label: 'Import' },
  { id: 'areas', label: 'Areas' },
  { id: 'launch', label: 'Launch' },
];
