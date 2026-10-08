import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const POST = serveOperation(z.object({ params: operations.resultIdInput, body: operations.requestReviewInput.omit({ id: true }) }).strict(), ({ params, body }, context) => operations.requestReview({ ...body, ...params }, context));
