import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const GET = serveOperation(z.object({ params: operations.resultIdInput }).strict(), ({ params }, context) => operations.get(params, context));
