import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod/v4';
import { OperationError } from '@/lib/server/operation';

// This experimental host has synthetic fixtures only. It is not an account
// connection, and grants no authority to Ri's integration runtime.
export function evaluationDirectory() {
  return path.resolve(process.env.RI_MCP_APPS_EVAL_DIR || path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'ri-mcp-apps-0a'));
}

const httpsOrigin = z.string().url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
});
const descriptorSchema = z.object({
  format: z.literal(1), pid: z.number().int().positive(),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  parentOrigin: httpsOrigin, hostOrigin: httpsOrigin, sandboxOrigin: httpsOrigin,
}).refine(value => new Set([value.parentOrigin, value.hostOrigin, value.sandboxOrigin]).size === 3);

function descriptor() {
  try {
    const value = descriptorSchema.parse(JSON.parse(fs.readFileSync(path.join(evaluationDirectory(), 'remote.json'), 'utf8')));
    process.kill(value.pid, 0);
    return value;
  } catch { return null; }
}

export function pluginEvaluationStatus() {
  const value = descriptor();
  return { available: !!value, parentOrigin: value?.parentOrigin ?? null };
}

export async function launchPluginEvaluation(parentOrigin: string) {
  const value = descriptor();
  if (!value) throw new OperationError(503, { error: 'evaluation_offline', message: 'The interactive examples are offline on your Home computer.' });
  if (parentOrigin !== value.parentOrigin) throw new OperationError(400, { error: 'unsupported_origin', message: 'Open these examples from your Home’s configured remote Ri URL.' });
  const response = await fetch('http://127.0.0.1:48885/__launch', {
    method: 'POST', headers: { 'x-ri-evaluation-key': value.key }, signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response?.ok) throw new OperationError(503, { error: 'evaluation_offline', message: 'The interactive examples could not start. Your conversation is still available.' });
  const result = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime() }).parse(await response.json());
  return { url: `${value.hostOrigin}/s/${result.token}/index.html`, expiresAt: result.expiresAt };
}
