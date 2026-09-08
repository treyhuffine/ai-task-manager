/**
 * Image-capture extraction, shared by POST /api/capture and the stream
 * retry route. Turns captured images (plus optional user text) into the
 * text a stream item carries.
 *
 * Runs through the default subscription harness (src/lib/harness/one-shot.ts)
 * rather than a direct API call: the images are already saved to the
 * attachments dir before extraction, so the harness reads them from disk
 * with its own file tools (Claude's Read renders images to the model;
 * Codex has its own image viewer).
 */

import { runHarnessText } from '@/lib/harness/one-shot';

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

export interface CapturedImage {
  /** Absolute path of the saved attachment file. */
  path: string;
  mime: string;
}

export async function extractImageContent(
  images: CapturedImage[],
  userText: string | null,
): Promise<string> {
  const fileList = images.map((img, i) => `${i + 1}. ${img.path} (${img.mime})`).join('\n');
  const promptParts = [
    userText?.trim() ? `User text accompanying the capture:\n${userText.trim()}` : null,
    `The captured image${images.length > 1 ? 's are' : ' is'} saved at:\n${fileList}`,
    'Open and look at each image, then output ONLY the extracted text as described above.',
  ].filter(Boolean);

  const { text } = await runHarnessText({
    label: 'capture-image',
    tier: 'standard',
    // One turn per image read plus the final answer.
    maxTurns: images.length + 2,
    timeoutSec: 120,
    system: IMAGE_CAPTURE_SYSTEM_PROMPT,
    prompt: promptParts.join('\n\n'),
    // Reading the just-saved attachment files is the whole job — file
    // viewing must not stall on a permission prompt. Edits stay denied;
    // Bash stays available for harnesses that view images through a CLI.
    skipPermissions: true,
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
  });
  return text;
}
