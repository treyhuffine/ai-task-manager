/**
 * What allowing an agent to use a personal app means, said before the app's own consent screen
 * opens (shared spec, Decision 3). Shared by the server and the screens, so both say the same.
 */
export function allowConsequence(appName: string, agentName: string): string {
  return `${agentName} will be able to see whatever ${appName} shows it, including anything ${appName} has read from your accounts. ${appName} asks next which of its data ${agentName} may see, and whether it may also make changes.`;
}
