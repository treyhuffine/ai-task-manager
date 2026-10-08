import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const POST = serveOperation(z.object({ params: operations.resultIdInput, body: operations.completeInput.omit({ id: true }) }).strict(), ({ params, body }, context) => operations.complete({ ...body, ...params }, context));
