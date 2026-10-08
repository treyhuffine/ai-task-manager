/**
 * An agent's standing instructions, as a session instructions block.
 *
 * The UI calls a workspace an agent (docs/agents-view-spec.md). Its
 * `instructions` are set in the agent view's Setup tab and reach every
 * execution the agent starts and to its main chat, through the same ordered
 * preference snapshot. Native session instructions or explicit app-owned
 * message context deliver them without rewriting the visible transcript.
 */

export interface AgentInstructionsSource {
  name: string;
  instructions: string | null;
}

/** The block, or an empty string when the agent has no instructions. */
export function renderAgentInstructionsPrompt(agent: AgentInstructionsSource): string {
  const text = agent.instructions?.trim();
  if (!text) return '';
  return [
    `## Standing instructions for the "${agent.name}" agent`,
    '',
    `The user keeps these instructions on "${agent.name}", the Ri agent this work belongs to. ` +
      'Follow them unless the current request says otherwise. ' +
      'They do not override app authorization, runtime guards, read-only restrictions, or the assigned role and scope.',
    '',
    text,
  ].join('\n');
}
