/**
 * An agent's standing instructions, as a session instructions block.
 *
 * The UI calls a workspace an agent (docs/agents-view-spec.md). Its
 * `instructions` are set in the agent view's Setup tab and reach every
 * execution the agent starts, through the session instructions file, so they
 * never show up in the visible transcript. The agent's main chat gets them as
 * part of its brief instead.
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
      'They apply to every task in it. Follow them unless the current request says otherwise.',
    '',
    text,
  ].join('\n');
}
