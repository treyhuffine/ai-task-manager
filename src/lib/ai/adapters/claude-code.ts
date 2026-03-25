import { getProvider } from '@agentex/agent';
import type { StreamEvent } from '@agentex/agent';

/**
 * Adapter that sends prompts to Claude Code via @agentex/agent.
 * Returns a ReadableStream compatible with the AI SDK's streaming format.
 *
 * This lets the user delegate coding tasks to Claude Code directly from Flow.
 */
export function streamClaudeCode(opts: {
  prompt: string;
  cwd?: string;
  sessionId?: string;
  model?: string;
}) {
  const claude = getProvider('claude');

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await claude.execute({
          prompt: opts.prompt,
          cwd: opts.cwd || process.cwd(),
          sessionParams: opts.sessionId ? { sessionId: opts.sessionId } : undefined,
          model: opts.model,
          config: {
            skipPermissions: false,
            maxTurns: 10,
            timeoutSec: 300,
          },
          onEvent: (event: StreamEvent) => {
            if (event.type === 'assistant' && event.text) {
              // Stream as AI SDK data stream protocol
              controller.enqueue(encoder.encode(`0:${JSON.stringify(event.text)}\n`));
            }
            if (event.type === 'tool_call') {
              // Surface tool calls as assistant text for visibility
              const toolMsg = `\n> Using tool: **${event.name}**\n`;
              controller.enqueue(encoder.encode(`0:${JSON.stringify(toolMsg)}\n`));
            }
          },
        });

        // Send finish reason
        controller.enqueue(
          encoder.encode(`d:${JSON.stringify({ finishReason: 'stop', usage: result.usage || {} })}\n`)
        );
        controller.close();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Claude Code execution failed';
        controller.enqueue(encoder.encode(`0:${JSON.stringify(`Error: ${msg}`)}\n`));
        controller.enqueue(
          encoder.encode(`d:${JSON.stringify({ finishReason: 'error' })}\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  });
}
