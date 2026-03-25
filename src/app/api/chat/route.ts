import type { UIMessage } from 'ai';
import { streamOpenAIChat } from '@/lib/ai/adapters/openai';
import { streamAnthropicChat } from '@/lib/ai/adapters/anthropic';
import { streamClaudeCode } from '@/lib/ai/adapters/claude-code';
import type { ChatProvider } from '@/lib/ai/types';

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  const {
    messages,
    provider = 'openai',
    model,
    cwd,
    sessionId,
  }: {
    messages: UIMessage[];
    provider?: ChatProvider;
    model?: string;
    cwd?: string;
    sessionId?: string;
  } = body;

  switch (provider) {
    case 'claude-code': {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
      const prompt = lastUserMessage
        ? lastUserMessage.parts
            ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join('\n') || ''
        : '';

      return streamClaudeCode({ prompt, cwd, sessionId, model });
    }

    case 'anthropic': {
      const result = await streamAnthropicChat(messages, model);
      return result.toUIMessageStreamResponse();
    }

    case 'mastra': {
      return new Response('Mastra provider not yet implemented', { status: 501 });
    }

    case 'openai':
    default: {
      const result = await streamOpenAIChat(messages, model);
      return result.toUIMessageStreamResponse();
    }
  }
}
