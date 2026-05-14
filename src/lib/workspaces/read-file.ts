/**
 * Read a single file from a workspace for the execution view's file
 * viewer. Caps at 1 MiB so we don't try to render a 50 MB SQLite dump
 * in CodeMirror; classifies binary files by sniffing the first 8 KiB
 * for null bytes so they short-circuit to a "binary — can't preview"
 * message rather than corrupting the viewer.
 *
 * Path traversal protection: `relPath` is `.normalize()`'d and rejected
 * if it escapes the workspace root via `..` or absolute paths. The
 * caller is trusted (this is a local app), but the worktree root is a
 * security boundary nonetheless — the same handler responds to the MCP
 * surface and we don't want a misbehaving agent to read arbitrary disk.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Workspace } from '@agentex/workspace';
import type { FileResponse } from '@/lib/api/sessions';

export type { FileResponse };

export const MAX_PREVIEW_BYTES = 1 * 1024 * 1024; // 1 MiB
const BINARY_SNIFF_BYTES = 8 * 1024; // 8 KiB

export class FileReadError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid_path' | 'is_directory' | 'io_error',
    message: string,
  ) {
    super(message);
    this.name = 'FileReadError';
  }
}

export async function readWorkspaceFile(
  ws: Workspace,
  relPath: string,
): Promise<FileResponse> {
  const safe = sanitizeRelPath(relPath);
  if (!safe) {
    throw new FileReadError('invalid_path', `Invalid path: ${relPath}`);
  }

  const absolute = path.join(ws.path, safe);
  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new FileReadError('not_found', `File not found: ${relPath}`);
    }
    throw new FileReadError('io_error', `Failed to stat: ${(err as Error).message}`);
  }

  if (stat.isDirectory()) {
    throw new FileReadError('is_directory', `${relPath} is a directory`);
  }

  const size = stat.size;
  const mime = mimeFor(safe);

  if (size > MAX_PREVIEW_BYTES) {
    return {
      path: safe,
      content: null,
      encoding: 'utf8',
      mime,
      size,
      isBinary: false,
      tooLarge: true,
    };
  }

  // Stream the first 8 KiB to sniff for binary content before
  // committing to a full read. For small files this is one fs call;
  // larger ones we read once then classify based on the sample.
  const buffer = await fs.readFile(absolute);
  const isBinary = sniffBinary(buffer.subarray(0, BINARY_SNIFF_BYTES));

  if (isBinary) {
    return {
      path: safe,
      content: null,
      encoding: 'base64',
      mime,
      size,
      isBinary: true,
    };
  }

  return {
    path: safe,
    content: buffer.toString('utf8'),
    encoding: 'utf8',
    mime,
    size,
    isBinary: false,
  };
}

function sanitizeRelPath(rel: string): string | null {
  if (!rel || typeof rel !== 'string') return null;
  if (path.isAbsolute(rel)) return null;
  // Reject any traversal — `path.normalize` would silently collapse them.
  if (rel.includes('\0')) return null;
  const normalized = path.normalize(rel).replace(/\\/g, '/');
  if (normalized.startsWith('..') || normalized.includes('/../') || normalized === '.') {
    return null;
  }
  return normalized;
}

function sniffBinary(sample: Buffer): boolean {
  // A single null byte in the first 8 KiB is the standard binary tell.
  // UTF-16 text would also trip this, but we don't bother — text files
  // in source repos are virtually all UTF-8.
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function mimeFor(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'application/javascript';
    case '.json':
      return 'application/json';
    case '.md':
    case '.mdx':
      return 'text/markdown';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    case '.toml':
      return 'application/toml';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'application/x-shellscript';
    case '.py':
      return 'text/x-python';
    case '.go':
      return 'text/x-go';
    case '.rs':
      return 'text/x-rust';
    case '.sql':
      return 'application/sql';
    default:
      return 'text/plain';
  }
}

/**
 * Read the base-branch version of a file from a git workspace, used by
 * the diff view's "old content" side. Falls back to empty string when
 * the file didn't exist on `base` (new file).
 */
export async function readBaseFile(
  ws: Workspace,
  relPath: string,
): Promise<string> {
  if (ws.kind !== 'git') return '';
  const safe = sanitizeRelPath(relPath);
  if (!safe) throw new FileReadError('invalid_path', `Invalid path: ${relPath}`);
  try {
    const result = await ws.git.raw(['show', `${ws.git.baseSha}:${safe}`]);
    if (result.exitCode !== 0) return '';
    return result.stdout;
  } catch {
    // File didn't exist on base (newly added file). Treat as empty.
    return '';
  }
}
