import { openai } from '@ai-sdk/openai';
import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { chatTools } from '@/lib/ai/chat-tools';
import { AGENT_SYSTEM_PROMPT } from '@/lib/ai/agent-prompt';
import { inlineTextAttachments } from '@/lib/ai/inline-text-attachments';
import { extractPdfsForOpenAI } from '@/lib/ai/extract-pdf-for-openai';

export async function streamOpenAIChat(messages: UIMessage[], model?: string) {
  // Two-pass attachment rewrite: PDF→text first (OpenAI doesn't accept
  // PDF parts the way Anthropic does), then the generic
  // text/image/docx/audio rewrite catches everything else.
  const pdfRewritten = await extractPdfsForOpenAI(messages);
  const rewritten = await inlineTextAttachments(pdfRewritten);
  return streamText({
    model: openai(model || process.env.MODEL_STANDARD || 'gpt-5.4-mini'),
    system: AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(rewritten),
    tools: chatTools,
    stopWhen: stepCountIs(10),
  });
}
