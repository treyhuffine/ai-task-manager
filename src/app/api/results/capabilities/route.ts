import { z } from 'zod/v4';
import { serveResultOperation as serveOperation } from '@/lib/server/result-adapter';
import * as operations from '@/lib/server/operations/results';

export const GET = serveOperation(z.object({}).strict(), operations.capabilities);
export const PATCH = serveOperation(z.object({ body: operations.capabilitiesInput }).strict(), ({ body }, context) => operations.setCapabilities(body, context));
