import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/desktop/oauth/cancel';
export const POST = serveOperation(operation.POSTInput, operation.POST);
