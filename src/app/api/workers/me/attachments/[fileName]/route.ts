/**
 * A file the person attached to a message, fetched by the worker of the
 * computer the message went to (docs/homes-build.md, "Attachments and
 * artifacts", P2.5). `?command=<id>` names the send that carries it, and
 * the file is served only while that send is this computer's to deliver:
 *
 * - the command's target is this worker's computer (404 otherwise, the same
 *   as a command that doesn't exist);
 * - it's a send the worker has and hasn't acknowledged yet (409);
 * - the chat is still placed on this computer at the command's generation
 *   (409, the command is stale);
 * - the file is one the command's payload names (404).
 *
 * A worker key reaches only worker routes, so this is the only way a worker
 * reads the home's attachments.
 */

import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { ATTACHMENT_FILE_NAME } from '@/lib/attachments/markers';
import { attachmentPath } from '@/lib/attachments/save';
import { chatPlacement, getWorkerCommand } from '@/lib/db/queries';
import type { SendPayload } from '@/lib/workers/protocol';
import { requireWorker } from '@/lib/workers/route-auth';

const notFound = (message: string) => Response.json({ error: 'not_found', message }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ fileName: string }> }) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const { fileName } = await params;
  const commandId = request.nextUrl.searchParams.get('command');
  if (!commandId || !ATTACHMENT_FILE_NAME.test(fileName)) {
    return Response.json({ error: 'invalid_params', message: 'Name a file and the command that carries it.' }, { status: 400 });
  }

  const command = getWorkerCommand(commandId);
  if (!command || command.computerId !== worker.computer.id) return notFound('This computer has no such command.');
  if (command.kind !== 'send' || command.state !== 'sent') {
    return Response.json(
      { error: 'not_waiting', message: "That message isn't waiting on this computer any more." },
      { status: 409 },
    );
  }
  const placement = command.chatSessionId ? chatPlacement(command.chatSessionId) : null;
  if (!placement || placement.computerId !== worker.computer.id || placement.generation !== command.generation) {
    return Response.json({ error: 'stale', message: 'That chat has moved from this computer.' }, { status: 409 });
  }
  const file = (command.payload as SendPayload).attachments?.find((a) => a.fileName === fileName);
  if (!file) return notFound("That message doesn't carry this file.");

  let stream: fs.ReadStream;
  let size: number;
  try {
    const handle = await fs.promises.open(attachmentPath(fileName), 'r');
    size = (await handle.stat()).size;
    stream = handle.createReadStream();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return notFound(`${file.originalName} is no longer at home.`);
    throw err;
  }
  // Checked again after opening: a worker turned off meanwhile gets nothing.
  const still = requireWorker(request.headers);
  if (still instanceof Response) {
    stream.destroy();
    return still;
  }
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'cache-control': 'no-store',
    },
  });
}
