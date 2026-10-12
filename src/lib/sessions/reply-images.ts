import { findReplyFile, type ReplyFileChat } from './reply-files';

export const REPLY_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export type { ReplyFile as ReplyImage, ReplyFileChat as ReplyImageChat } from './reply-files';
export { resolveReplyFilePath as resolveReplyImagePath } from './reply-files';

export function findReplyImage(chat: ReplyFileChat, requested: string, agentNamed: (text: string) => boolean) {
  return findReplyFile(chat, requested, agentNamed, { kind: 'image', maxBytes: REPLY_IMAGE_MAX_BYTES });
}
