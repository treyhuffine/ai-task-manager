import type { Attachment, ChatEventRecord } from '@/db/types';
import { isLocalArtifactTarget } from './reply-artifacts';
import { rewriteLocalFileReferences } from './local-file-references';
import { isLocalTextTarget } from './reply-text';

/** File references only. Tool activity and web links never become deliverables. */
export function messageArtifactPaths(markdown: string): string[] {
  const paths = new Set<string>();
  rewriteLocalFileReferences(markdown, {
    extensions: '[a-z0-9][a-z0-9._+-]*', anyFile: true, matches: isLocalArtifactTarget,
    render: target => {
      paths.add(isLocalTextTarget(target) ? target.split('#')[0].replace(/:\d+(?::\d+)?$/, '') : target);
      return '';
    },
    marker: {
      pattern: /\uE200visualize\uE202([\s\S]*?)\uE201/g,
      target: match => {
        try { const value = JSON.parse(match[1]); return typeof value?.path === 'string' ? value.path : null; }
        catch { return null; }
      },
    },
  });
  return [...paths];
}

export type ArtifactMessage = Pick<ChatEventRecord, 'id' | 'sessionId' | 'createdAt' | 'source' | 'content'> & { attachments: Attachment[] | null };
export type ArtifactCursor = Pick<ChatEventRecord, 'createdAt' | 'id'>;
