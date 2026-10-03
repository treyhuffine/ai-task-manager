import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Manual preview URLs on an execution (BYO tunnel — §6). The user runs
 * their own tunnel (ngrok/cloudflared/whatever) and pastes the URL; the
 * ManualProvider serves it. `PUT` replaces the whole list (set-or-clear);
 * send `[]` to clear.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { setPreviewUrls } from '@/lib/preview/service';
import { z } from 'zod';

const previewUrlSchema = z.object({
  service: z.string().trim().min(1).nullable().optional(),
  url: z.string().trim().url('Must be a valid http(s) URL'),
  label: z.string().trim().min(1).nullable().optional(),
});

const bodySchema = z.object({
  urls: z.array(previewUrlSchema).max(20),
});

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const parsed = bodySchema.safeParse(rpcInput.body);
    if (!parsed.success) {
      return reply(
        { error: 'invalid_params', message: parsed.error.issues[0]?.message ?? 'Invalid preview URLs.' },
        { status: 400 },
      );
    }
    const urls = parsed.data.urls.map((u) => ({
      service: u.service ?? null,
      url: u.url,
      label: u.label ?? null,
    }));
    return reply({ urls: setPreviewUrls(id, urls) });
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'PUT /api/executions/:id/preview-urls'));
  }
}

export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: legacySchema(bodySchema) }).strict();
