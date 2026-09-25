/**
 * Which surface the main chat runs on. `user_state.orchestratorMode` can be
 * null (a home where nobody has chosen) or 'legacy' (the retired built-in
 * chat, whose /api/chat route no longer exists), and both run as the MCP
 * surface. The server's session spec and the UI resolve through this one
 * rule so they can never disagree about which chat the user is in: when the
 * UI fell back to 'legacy' on its own, a fresh home's main chat posted to the
 * missing route and did nothing.
 *
 * Pure and dependency-free: imported by client components.
 */

export type OrchestratorChatMode = 'harness_skills' | 'harness_mcp';

export function resolveOrchestratorMode(stored: string | null | undefined): OrchestratorChatMode {
  return stored === 'harness_skills' ? 'harness_skills' : 'harness_mcp';
}
