import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/dev/sessions/[id]/inject';
export const POST = serveOperation(operation.POSTInput, operation.POST);
