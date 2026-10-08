import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const POST = serveOperation(z.object({ params: operations.retryFeedbackInput }).strict(), ({ params }, context) => operations.retryFeedback(params, context));
