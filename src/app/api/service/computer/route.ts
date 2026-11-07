import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/service/computer';

export const GET = serveOperation(operation.GETInput, operation.GET);
