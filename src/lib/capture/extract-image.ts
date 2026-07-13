/**
 * Image-capture extraction, shared by POST /api/capture and the stream
 * retry route. Turns captured images (plus optional user text) into the
 * text a stream item carries.
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export const IMAGE_CAPTURE_SYSTEM_PROMPT = `You are the capture assistant for a personal productivity app. The user just snapped or uploaded an image they want added to their inbox. Your job is to turn it into useful text the user will see later when triaging.

The image could be anything:
- A photo of a whiteboard, notebook, receipt, book page, or sign with text the user wants captured
- A screenshot of an app, article, message, or UI
- A scene, object, person, place, or product they want to remember
- A diagram, sketch, or mind map

Use your judgment about what the user most likely wants:
- If it's primarily text content (notes, receipt, page, screenshot of writing), transcribe the text cleanly. Preserve structure (headings, bullets, line breaks) in Markdown. Skip decorative UI chrome unless relevant.
- If it's a scene/object/product, describe it concisely in one or two sentences, noting anything actionable (e.g. "business card for Jane Doe, jane@acme.com, 415-555-0100").
- If it's a diagram or sketch, describe the content and any text/labels present.

The user may also provide a text field along with the image. That field can be one of two things, decide from context:
- Additional content they want captured alongside the image (e.g. "reminder to call them back" with a photo of a business card). Include it naturally in your output.
- An instruction about how to handle the image (e.g. "just the dates", "translate to English", "summarize the whiteboard"). Follow the instruction.

Output the text only, no preamble, no "Here is...", no meta-commentary. The text you produce will be saved verbatim as a stream item the user will read.`;

export async function extractImageContent(
  imageItems: { bytes: Uint8Array; mime: string }[],
  userText: string | null,
): Promise<string> {
  const model = process.env.MODEL_STANDARD || 'gpt-5.4-mini';

  const contentSegments: Array<
    { type: 'text'; text: string } | { type: 'image'; image: Uint8Array; mediaType: string }
  > = [
    ...(userText && userText.trim() ? [{ type: 'text' as const, text: userText.trim() }] : []),
  ];

  for (const item of imageItems) {
    contentSegments.push({ type: 'image' as const, image: item.bytes, mediaType: item.mime });
  }

  const result = await generateText({
    model: openai(model),
    system: IMAGE_CAPTURE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: contentSegments,
      },
    ],
  });
  return result.text.trim();
}
