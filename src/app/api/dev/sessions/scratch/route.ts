import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/dev/sessions/scratch';
export const GET = serveOperation(operation.GETInput, operation.GET);
