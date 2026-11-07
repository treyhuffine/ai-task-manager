import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/service/touch';

export const POST = serveOperation(operation.POSTInput, operation.POST);
