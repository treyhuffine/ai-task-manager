import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/notifications/web-push/public-key';


export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
