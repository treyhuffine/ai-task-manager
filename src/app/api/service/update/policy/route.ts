import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/service/update/policy';


export const PATCH = withCompression(serveOperation(operation.PATCHInput, operation.PATCH, { maxBodyBytes: 4096, oversizedStatus: 400 }));
