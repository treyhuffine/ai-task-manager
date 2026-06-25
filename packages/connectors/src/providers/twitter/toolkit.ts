/**
 * The `twitter` toolkit — every X API v2 operation (Stream + Webhooks excluded), generated from X's
 * OpenAPI spec into `operations.generated.ts` and turned into engine actions here. This mirrors how
 * XMCP works (spec → tools) but produces real, scoped, approval-gated engine actions.
 *
 * Each action's input schema is reconstructed from the operation's merged path/query/body params via
 * the engine's JSON-Schema → Zod converter (shared with MCP ingest). The request builder fills path
 * placeholders, assembles the JSON body, and routes the rest to the query string (comma-joining
 * arrays, since X uses `explode:false` for fields/expansions params).
 */
import { z } from 'zod';
import { action, defineToolkit, httpAction, type HttpActionRequest } from '../../core/authoring';
import { ConnectorError } from '../../core/errors';
import { jsonSchemaToZodObject } from '../../mcp/json-schema';
import type { Action, ActionContext, RiskLevel, Toolkit } from '../../core/types';
import { TWITTER_OPS, type TwitterOp } from './operations.generated';

/** Per-segment size for chunked media upload. X caps an append segment at ~5 MiB; 4 MiB is safe. */
const DEFAULT_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;

export interface TwitterToolkitOptions {
  /** Only include these operationIds / action ids (parity with XMCP's X_API_TOOL_ALLOWLIST). */
  allowlist?: string[];
  /** Exclude these operationIds / action ids. Applied after the allowlist. */
  denylist?: string[];
  /** Only include operations carrying one of these tags (parity with XMCP's X_API_TOOL_TAGS). */
  tags?: string[];
  /** Append segment size for `twitter.upload_media` (bytes). Defaults to 4 MiB; mainly for tests. */
  mediaChunkBytes?: number;
}

function idIncluded(operationId: string, id: string, allow?: Set<string>, deny?: Set<string>): boolean {
  if (deny && (deny.has(operationId) || deny.has(id))) return false;
  if (allow && !(allow.has(operationId) || allow.has(id))) return false;
  return true;
}

/** XMCP-style tag gate: with a tag filter set, keep only operations sharing one of the tags. */
function tagsAllowed(opTags: string[], allowTags?: Set<string>): boolean {
  if (!allowTags || allowTags.size === 0) return true;
  return opTags.some((t) => allowTags.has(t.toLowerCase()));
}

function included(op: TwitterOp, allow?: Set<string>, deny?: Set<string>, allowTags?: Set<string>): boolean {
  return idIncluded(op.operationId, op.id, allow, deny) && tagsAllowed(op.tags, allowTags);
}

function buildRequest(op: TwitterOp, input: Record<string, unknown>): HttpActionRequest {
  let path = op.path;
  for (const p of op.pathParams) {
    path = path.replace(`{${p}}`, encodeURIComponent(String(input[p] ?? '')));
  }

  let body: unknown;
  if (op.bodyRoot) {
    body = input.body;
  } else if (op.bodyParams.length) {
    const b: Record<string, unknown> = {};
    for (const k of op.bodyParams) if (input[k] !== undefined) b[k] = input[k];
    if (Object.keys(b).length) body = b;
  }

  const pathSet = new Set(op.pathParams);
  const bodySet = new Set(op.bodyRoot ? ['body'] : op.bodyParams);
  const query: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input)) {
    if (pathSet.has(k) || bodySet.has(k)) continue;
    if (v === undefined || v === null) continue;
    // X array query params (tweet.fields, expansions, …) are explode:false → comma-joined.
    query[k] = Array.isArray(v) ? v.join(',') : (v as string | number | boolean);
  }

  return {
    method: op.method,
    path,
    ...(Object.keys(query).length ? { query } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

function toAction(op: TwitterOp): Action {
  return httpAction({
    id: op.id,
    description: op.description,
    ...(op.scopes.length ? { scopes: op.scopes } : {}),
    mutating: op.mutating,
    risk: op.risk as RiskLevel,
    input: jsonSchemaToZodObject(op.inputSchema),
    request: (input) => buildRequest(op, input as Record<string, unknown>),
  });
}

/** Extract the media id from an init/finalize response (v2 `data.id`; v1.1 `media_id_string`). */
function mediaIdOf(res: unknown): string | undefined {
  const d = (res as { data?: { id?: string; media_id_string?: string; media_id?: string | number } }).data;
  if (!d) return undefined;
  if (d.id) return d.id;
  if (d.media_id_string) return d.media_id_string;
  return d.media_id != null ? String(d.media_id) : undefined;
}

/**
 * `twitter.upload_media` — a one-call media upload that runs X's chunked init → append → finalize
 * flow with base64 JSON bodies (the append endpoint accepts application/json), so it works for any
 * size without a multipart/binary body. Returns the finalize payload (its `id` is what create_posts
 * takes as `media.media_ids`). For video, X may still be processing on return — poll
 * `twitter.get_media_upload_status`. This is the gap XMCP's generic generated tool can't cover.
 */
function buildUploadMediaAction(chunkBytes: number): Action {
  return action({
    id: 'twitter.upload_media',
    description:
      'Upload an image, GIF, or video in one call (handles chunked init/append/finalize). `media` is base64-encoded file bytes. Returns a media id to pass to create_posts as media.media_ids. For video, poll twitter.get_media_upload_status if still processing.',
    scopes: ['media.write'],
    mutating: true,
    risk: 'medium',
    input: z.object({
      media: z.string().describe('Base64-encoded media bytes'),
      media_type: z.string().describe('MIME type, e.g. image/png, image/gif, video/mp4'),
      media_category: z
        .string()
        .optional()
        .describe('tweet_image | tweet_gif | tweet_video | dm_image | dm_gif | dm_video | subtitles'),
      additional_owners: z.array(z.string()).optional().describe('User ids also allowed to use the media'),
    }),
    async execute(ctx: ActionContext, input) {
      const bytes = Buffer.from(input.media, 'base64');
      if (bytes.length === 0) throw new ConnectorError('invalid_input', 'twitter.upload_media: media is empty');

      const init = await ctx.http.post('/2/media/upload/initialize', {
        media_type: input.media_type,
        total_bytes: bytes.length,
        ...(input.media_category ? { media_category: input.media_category } : {}),
        ...(input.additional_owners ? { additional_owners: input.additional_owners } : {}),
      });
      const id = mediaIdOf(init);
      if (!id) throw new ConnectorError('provider_error', 'twitter.upload_media: initialize returned no media id');

      let segment = 0;
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const chunk = bytes.subarray(offset, offset + chunkBytes).toString('base64');
        await ctx.http.post(`/2/media/upload/${encodeURIComponent(id)}/append`, {
          segment_index: segment,
          media: chunk,
        });
        segment++;
      }

      const finalized = await ctx.http.post(`/2/media/upload/${encodeURIComponent(id)}/finalize`, {});
      const data = (finalized as { data?: unknown }).data;
      return data ?? finalized;
    },
  });
}

/** Build the X toolkit, optionally trimmed by an allow/deny list. */
export function buildTwitterToolkit(options: TwitterToolkitOptions = {}): Toolkit {
  const allow = options.allowlist?.length ? new Set(options.allowlist) : undefined;
  const deny = options.denylist?.length ? new Set(options.denylist) : undefined;
  const allowTags = options.tags?.length ? new Set(options.tags.map((t) => t.toLowerCase())) : undefined;
  const actions: Action[] = TWITTER_OPS.filter((op) => included(op, allow, deny, allowTags)).map(toAction);

  // Blessed chunked-upload helper (closes the binary media-append gap). Subject to allow/deny and the
  // tag filter (treated as Media/Tweets); matchable by id `twitter.upload_media` or alias `uploadMedia`.
  if (idIncluded('uploadMedia', 'twitter.upload_media', allow, deny) && tagsAllowed(['Media', 'Tweets'], allowTags)) {
    actions.push(buildUploadMediaAction(options.mediaChunkBytes ?? DEFAULT_MEDIA_CHUNK_BYTES));
  }

  return defineToolkit({
    id: 'twitter',
    providerId: 'twitter',
    displayName: 'X (Twitter)',
    actions,
  });
}

/** The full X toolkit (every supported operation). */
export const twitterToolkit: Toolkit = buildTwitterToolkit();
