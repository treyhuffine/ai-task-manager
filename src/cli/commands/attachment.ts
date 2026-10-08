import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import type { Attachment } from '@/db/types';
import { serverFetch } from '@/lib/orchestrator/server-client';
import { getInstallationRole } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';
import { homeFetch } from '@/lib/connection/home-client';
import { SESSION_CREDENTIAL_ENV, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { resolveMime, isAllowedMime } from '@/lib/attachments/mime';

/** Upload explicitly selected local bytes through the existing attachment API.
 * The server never accepts a filesystem path or imports a remote caller's file. */
export async function uploadLocalAttachment(filePath: string): Promise<Attachment> {
  const resolved = path.resolve(filePath);
  if (!(await fs.lstat(resolved)).isFile()) throw new Error('Select a regular file.');
  const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Select a regular file.');
    if (stat.size <= 0 || stat.size > 50 * 1024 * 1024) throw new Error('Select a nonempty file of at most 50 MiB.');
    const originalName = path.basename(resolved);
    const mimeType = resolveMime(null, originalName);
    if (!isAllowedMime(mimeType)) throw new Error(`Unsupported attachment type: ${mimeType}`);
    const bytes = await handle.readFile();
    if (bytes.length > 50 * 1024 * 1024) throw new Error('The file exceeds 50 MiB.');
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), originalName);
    const credential = process.env[SESSION_CREDENTIAL_ENV];
    const init = { method: 'POST', body: form, ...(credential ? { headers: { [SESSION_CREDENTIAL_HEADER]: credential } } : {}) };
    if (getInstallationRole() === 'connected') {
      const connection = readConnection();
      if (!connection) throw new Error('This device is not connected to a home.');
      const response = await homeFetch(connection, '/api/attachments', init);
      if (!response.ok) throw new Error(`Attachment upload failed (${response.status}).`);
      return await response.json() as Attachment;
    }
    return serverFetch<Attachment>('/attachments', init);
  } finally { await handle.close(); }
}

export function registerAttachmentCommand(program: Command): void {
  program.command('attachment').description('Upload an existing file to Ri')
    .command('upload <path>').description('Upload a selected local file and return its durable attachment record')
    .action(async (filePath: string) => {
      process.stdout.write(`${JSON.stringify(await uploadLocalAttachment(filePath), null, 2)}\n`);
    });
}
