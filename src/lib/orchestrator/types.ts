/**
 * Contract-first action definitions for the agent orchestrator.
 *
 * A single action registry generates both the CLI (`<cli> agent <name>`) and
 * the orchestrator MCP (`/api/orchestrator/[transport]`). Same params, same
 * handler, same validation — two transports.
 *
 * Kept separate from the external user-facing MCP at `/api/[transport]`, which
 * is a thin natural-language interface. The orchestrator is fine-grained and
 * typed — one tool per verb — for in-repo agents doing CRUD work.
 */

import type { z } from 'zod';

export interface ActionContext {
  /**
   * True when the caller is remote/untrusted (HTTP MCP).
   * False for local CLI invocations by the owner of the machine.
   * Security-sensitive actions may tighten behavior when remote=true.
   */
  remote: boolean;
}

export class ActionError extends Error {
  constructor(
    public code:
      | 'not_found'
      | 'invalid_params'
      | 'conflict'
      | 'unsupported',
    message: string,
    public suggestion?: string,
  ) {
    super(message);
    this.name = 'ActionError';
  }

  toJSON() {
    return { error: this.code, message: this.message, suggestion: this.suggestion };
  }
}

export interface Action<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  params: Shape;
  mutating?: boolean;
  handler: (
    ctx: ActionContext,
    input: z.infer<z.ZodObject<Shape>>,
  ) => unknown | Promise<unknown>;
  cli?: {
    positional?: Array<Extract<keyof Shape, string>>;
  };
}

export function defineAction<Shape extends z.ZodRawShape>(
  action: Action<Shape>,
): Action<z.ZodRawShape> {
  return action as unknown as Action<z.ZodRawShape>;
}
