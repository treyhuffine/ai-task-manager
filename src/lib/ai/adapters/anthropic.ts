import { anthropic } from '@ai-sdk/anthropic';
import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { chatTools } from '@/lib/ai/chat-tools';
import { AGENT_SYSTEM_PROMPT } from '@/lib/ai/agent-prompt';
import { inlineTextAttachments } from '@/lib/ai/inline-text-attachments';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250514';

export async function streamAnthropicChat(messages: UIMessage[], model?: string) {
  return streamText({
    model: anthropic(model || DEFAULT_MODEL),
    system: AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(inlineTextAttachments(messages)),
    tools: chatTools,
    stopWhen: stepCountIs(10),
  });
}
