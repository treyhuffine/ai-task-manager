import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/sessions/[id]/dir';


export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST));
export const DELETE = withCompression(serveOperation(operation.DELETEInput, operation.DELETE));
