/**
 * Provider abstraction for chat backends.
 *
 * The chat API route uses these types so we can swap between:
 * - Direct AI SDK (Anthropic/OpenAI via streamText)
 * - @agentex/agent (Claude Code, Codex, etc.)
 * - Mastra workflows (future)
 */

export type ChatProvider = 'openai' | 'anthropic' | 'claude-code' | 'mastra';

export interface ChatRequestBody {
  messages: Array<{ role: string; content: string }>;
  provider?: ChatProvider;
  model?: string;
  /** For @agentex/agent: working directory for the coding agent */
  cwd?: string;
  /** For @agentex/agent: session ID to resume */
  sessionId?: string;
}
