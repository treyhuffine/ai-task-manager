import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const GET = serveOperation(z.object({ params: operations.previewInput }).strict(), ({ params }, context) => operations.preview(params, context));
export const POST = serveOperation(z.object({ params: operations.previewInput, body: operations.openPreviewInput.pick({ remote: true }) }).strict(), ({ params, body }, context) => operations.openPreview({ ...body, ...params }, context));
