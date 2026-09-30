/**
 * Files attached to a message sent to this computer (docs/homes-build.md,
 * "Attachments and artifacts", P2.5). Before the message goes in, the worker
 * fetches each file the send names through the worker attachment route,
 * checks its size and sha256, and keeps it under
 * `<workDir>/attachments/<homeId>/<chat>/`, outside any repository. The
 * harness gets this computer's path where each marker was.
 *
 * A file is written to a temporary name, flushed, and renamed only once it
 * checks out, so a file under its own name is always whole. A copy already
 * here that matches is used as it is.
 *
 * Where a file goes depends only on the home, the chat and the file name, so
 * after a restart the message is placed the same way without fetching
 * again. That's the text the send's recovery looks for in the native
 * history.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_FILE_NAME, placeFileMarkers } from '@/lib/attachments/markers';
import { getWorkDir } from '@/lib/config/paths';
import type { InputFile } from '@/lib/runner/types';
import { WorkerNetworkError, WorkerStoppedError, workerFetch, type WorkerTarget } from './client';

/** A 50 MiB file over a slow link, with room to spare. */
const FETCH_TIMEOUT_MS = 10 * 60_000;
const ATTEMPTS = 3;

/** Ids from the home become folder names here, so only plain ids pass. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

export function inputFilesDir(homeId: string, chatSessionId: string): string {
  if (!PLAIN_ID.test(homeId) || !PLAIN_ID.test(chatSessionId)) {
    throw new InputFileError(`"${chatSessionId}" isn't a chat id this computer can keep files for.`);
  }
  return path.join(getWorkDir(), 'attachments', homeId, chatSessionId);
}

/** The message with each sent file's marker replaced by its path here. */
export function placeInputFiles(message: string, dir: string, files: InputFile[]): string {
  const sent = new Set(files.map((f) => f.fileName).filter((name) => ATTACHMENT_FILE_NAME.test(name)));
  return placeFileMarkers(message, (fileName) => (sent.has(fileName) ? path.join(dir, fileName) : null));
}

/** A file that couldn't be brought here. The message isn't sent, and this says why. */
export class InputFileError extends Error {
  constructor(
    message: string,
    /** Worth another try now: the connection dropped, or the bytes came short. */
    readonly passing = false,
  ) {
    super(message);
    this.name = 'InputFileError';
  }
}

export interface FetchInputFilesArgs {
  target: WorkerTarget;
  /** The send that carries the files, which is what lets the home serve them. */
  commandId: string;
  dir: string;
  files: InputFile[];
  /** Between attempts. Tests shorten it. */
  retryMs?: number;
}

/** Bring every file the send names here, or throw `InputFileError` saying which one didn't come and why. */
export async function fetchInputFiles(args: FetchInputFilesArgs): Promise<void> {
  for (const file of args.files) {
    if (!ATTACHMENT_FILE_NAME.test(file.fileName)) {
      throw new InputFileError(`${args.target.homeName} sent an attachment with a name that isn't a file name.`);
    }
    const dest = path.join(args.dir, file.fileName);
    if (await matches(dest, file)) continue;
    removeLeftovers(args.dir, file.fileName);
    for (let attempt = 1; ; attempt++) {
      try {
        await fetchOne(args, file, dest);
        break;
      } catch (err) {
        const passing = err instanceof WorkerNetworkError || (err instanceof InputFileError && err.passing);
        if (!passing || attempt >= ATTEMPTS) {
          if (err instanceof InputFileError || err instanceof WorkerStoppedError) throw err;
          throw new InputFileError(
            `Couldn't fetch ${file.originalName} from ${args.target.homeName}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, (args.retryMs ?? 1_000) * attempt));
      }
    }
  }
}

async function fetchOne(args: FetchInputFilesArgs, file: InputFile, dest: string): Promise<void> {
  const { target } = args;
  const res = await workerFetch(
    target,
    `/api/workers/me/attachments/${encodeURIComponent(file.fileName)}?command=${encodeURIComponent(args.commandId)}`,
    { timeoutMs: FETCH_TIMEOUT_MS },
  );
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new InputFileError(
      `Couldn't fetch ${file.originalName} from ${target.homeName}: ${body?.message ?? `HTTP ${res.status}`}`,
    );
  }

  const temp = path.join(args.dir, `.${file.fileName}.${randomUUID()}.part`);
  const hash = createHash('sha256');
  let size = 0;
  try {
    fs.mkdirSync(args.dir, { recursive: true });
    const out = await fs.promises.open(temp, 'w');
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > file.size) {
          throw new InputFileError(`${file.originalName} came from ${target.homeName} larger than it said it is.`);
        }
        hash.update(chunk);
        await out.write(chunk);
      }
      await out.sync();
    } finally {
      await out.close();
    }
    if (size !== file.size) {
      throw new InputFileError(`${file.originalName} came from ${target.homeName} incomplete.`, true);
    }
    if (hash.digest('hex') !== file.sha256) {
      throw new InputFileError(`${file.originalName} came from ${target.homeName} damaged: it doesn't match its checksum.`, true);
    }
    fs.renameSync(temp, dest);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    if (err instanceof InputFileError || err instanceof WorkerStoppedError) throw err;
    if ((err as NodeJS.ErrnoException).syscall) {
      throw new InputFileError(`Couldn't save ${file.originalName} on this computer: ${(err as Error).message}`);
    }
    // Anything else is the connection dropping mid-file.
    throw new InputFileError(`${file.originalName} stopped arriving from ${target.homeName}.`, true);
  }
}

/** Partial downloads of this file that a crash left behind. */
function removeLeftovers(dir: string, fileName: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(`.${fileName}.`) && entry.endsWith('.part')) fs.rmSync(path.join(dir, entry), { force: true });
  }
}

/** Whether the file is here already, whole. */
async function matches(dest: string, file: InputFile): Promise<boolean> {
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of fs.createReadStream(dest)) {
      hash.update(chunk as Buffer);
      size += (chunk as Buffer).byteLength;
      if (size > file.size) return false;
    }
  } catch {
    return false;
  }
  return size === file.size && hash.digest('hex') === file.sha256;
}
