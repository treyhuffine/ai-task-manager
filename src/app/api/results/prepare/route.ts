import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const POST = serveOperation(z.object({ body: operations.prepareInput }).strict(), ({ body }, context) => operations.prepare(body, context));
