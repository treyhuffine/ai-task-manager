import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/sessions/[id]/read';


export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST));
