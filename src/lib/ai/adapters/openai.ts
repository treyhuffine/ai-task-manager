import { openai } from '@ai-sdk/openai';
import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { chatTools } from '@/lib/ai/chat-tools';
import { AGENT_SYSTEM_PROMPT } from '@/lib/ai/agent-prompt';

export async function streamOpenAIChat(messages: UIMessage[], model?: string) {
  return streamText({
    model: openai(model || process.env.MODEL_STANDARD || 'gpt-4o'),
    system: AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: chatTools,
    stopWhen: stepCountIs(10),
  });
}
