import type { View } from './store';

/**
 * Files opened through OpenAI's file entrypoint (docs/connected-mcp-apps.md,
 * "Files"). Ri gives the view an opaque host URI for the file, never its path,
 * and answers `resources/read`, `resources/subscribe` and
 * `openai/resources/write` for that URI itself.
 *
 * This module is the seam the view service calls. File entrypoints are not
 * wired yet, so every entry point refuses plainly.
 */
const UNAVAILABLE = 'Opening files in connected apps is not available yet.';

/** Whether `uri` names a file Ri opened for a view, rather than one of the server's resources. */
export function isHostResource(uri: string): boolean {
  return uri.startsWith('ri-file:');
}

/** The `FileInput` a file entrypoint receives, and the capture's record of the file. */
export async function fileLaunchInput(_request: { viewerId: string; serverId: string; chatId?: string; extensions: string[]; handle?: string }): Promise<{ input: Record<string, unknown>; file: { handle: string; name: string } }> {
  throw new Error(UNAVAILABLE);
}

/** A host resource's content, as `resources/read` returns it, with OpenAI's `openai/resource` metadata (`etag`, `writable`). */
export interface HostResourceContent { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> }

export async function readHostResource(_view: View, _uri: string, _meta?: Record<string, unknown>): Promise<{ contents: HostResourceContent[] }> {
  throw new Error(UNAVAILABLE);
}
