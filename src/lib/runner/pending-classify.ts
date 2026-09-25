/**
 * Turn an agentex input request into a pending prompt: a question when it's
 * `AskUserQuestion`, a tool permission otherwise.
 */

import { parseAskUserQuestion, type UserInputRequest } from '@agentex/agent';
import type { PendingInput } from './pending';

/** Convert a UserInputRequest into a PendingInput. Returns null for unknown shapes. */
export function classifyRequest(
  sessionId: string,
  req: UserInputRequest,
): PendingInput {
  const questions = parseAskUserQuestion(req);
  if (questions) {
    return {
      kind: 'question',
      requestId: req.toolUseId,
      sessionId,
      toolUseId: req.toolUseId,
      questions,
      originalInput: req.input,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    kind: 'permission',
    requestId: req.toolUseId,
    sessionId,
    toolUseId: req.toolUseId,
    toolName: req.toolName,
    input: req.input,
    title: req.title ?? null,
    description: req.description ?? null,
    createdAt: new Date().toISOString(),
  };
}
