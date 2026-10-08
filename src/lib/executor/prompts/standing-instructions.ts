import { renderAgentInstructionsPrompt, type AgentInstructionsSource } from './agent-instructions';

/** Complete current snapshot of existing general agent instructions. */
export function renderStandingAgentInstructionsPrompt(agent: AgentInstructionsSource | null): string {
  return [
    '## Current Ri agent instruction preferences',
    'This snapshot replaces earlier agent instruction preferences supplied by Ri, including instructions that are now unset.',
    'The current request takes precedence over agent instruction preferences. Preferences do not override app authorization, runtime guards, read-only restrictions, or the assigned role and scope.',
    agent && renderAgentInstructionsPrompt(agent) || '## Agent instructions\n\nNo agent instructions apply to this chat.',
  ].join('\n\n');
}

/** Explicit app context for providers without a native instruction channel. */
export function withAppSessionInstructions(message: string, instructions: string | null): string {
  if (!instructions) return message;
  return [
    '[Current session instructions supplied by Ri. This is app context, not text typed by the user.]',
    instructions,
    '[The current request follows.]',
    message,
  ].join('\n\n');
}
