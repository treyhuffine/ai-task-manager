import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

const query = operations.listInput.omit({ limit: true, offset: true, includeSuperseded: true }).extend({ limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).optional(), includeSuperseded: z.enum(['true', 'false']).optional() }).strict();
export const GET = serveOperation(z.object({ query: query.optional() }).strict(), ({ query = {} }, context) => operations.list({ ...query, includeSuperseded: query.includeSuperseded === 'true' }, context));
export const POST = serveOperation(z.object({ body: operations.saveInput }).strict(), ({ body }, context) => operations.save(body, context));
