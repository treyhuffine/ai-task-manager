import { withCompression } from '@/lib/api/compression';
import { serveOperation } from '@/lib/server/operation';
import * as operation from '@/lib/server/operations/sessions/[id]/terminals';
export const runtime = 'nodejs';

export const GET = withCompression(serveOperation(operation.GETInput, operation.GET));
export const POST = withCompression(serveOperation(operation.POSTInput, operation.POST));

export const dynamic = 'force-dynamic';
