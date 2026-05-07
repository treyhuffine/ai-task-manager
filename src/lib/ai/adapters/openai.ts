import { openai } from '@ai-sdk/openai';
import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { chatTools } from '@/lib/ai/chat-tools';
import { AGENT_SYSTEM_PROMPT } from '@/lib/ai/agent-prompt';
import { inlineTextAttachments } from '@/lib/ai/inline-text-attachments';

export async function streamOpenAIChat(messages: UIMessage[], model?: string) {
  return streamText({
    model: openai(model || process.env.MODEL_STANDARD || 'gpt-5.4-mini'),
    system: AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(inlineTextAttachments(messages)),
    tools: chatTools,
    stopWhen: stepCountIs(10),
  });
}
