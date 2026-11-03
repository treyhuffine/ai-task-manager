import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { aesGcmSecretBox, generateSecretKey } from '@integrations/engine/crypto';
import { getConfigDir } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-write';

export interface ConversationSecrets { botToken?: string; appToken?: string; bridgeToken?: string }
const directory = () => path.join(/* turbopackIgnore: true */ getConfigDir(), 'conversation-integrations');
function file(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid connection ID.');
  return path.join(/* turbopackIgnore: true */ directory(), `${id}.sealed`);
}
function key() {
  const target = path.join(/* turbopackIgnore: true */ directory(), 'key');
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(target, generateSecretKey(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return fs.readFileSync(/* turbopackIgnore: true */ target, 'utf8').trim();
}
export async function saveConversationSecrets(id: string, secrets: ConversationSecrets) {
  atomicWriteFile(file(id), await aesGcmSecretBox({ key: key() }).seal(secrets));
}
export async function readConversationSecrets(id: string): Promise<ConversationSecrets> {
  return aesGcmSecretBox({ key: key() }).open<ConversationSecrets>(fs.readFileSync(/* turbopackIgnore: true */ file(id), 'utf8'));
}
export function deleteConversationSecrets(id: string) { fs.rmSync(file(id), { force: true }); }
export const newConversationToken = () => randomBytes(24).toString('hex');
export const conversationHash = (text: string) => createHash('sha256').update(text).digest('hex');
export function sameConversationToken(a: string, b: string) { return timingSafeEqual(Buffer.from(conversationHash(a)), Buffer.from(conversationHash(b))); }
