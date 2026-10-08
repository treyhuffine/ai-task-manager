'use client';

import { EntityAwareText } from '@/components/ai-elements/entity-reference';
import { MessageResponse } from '@/components/ai-elements/message';
import { MessageFileChip } from '@/components/chat/message-file-chip';
import { parseFileMarkers } from '@/components/chat/editor/parse-file-markers';
import type { WorkResultRecord } from '@/db/types';

export function ResultBody({ result }: { result: Pick<WorkResultRecord, 'body' | 'attachments'> }) {
  return <div className="text-[13px] leading-relaxed">{parseFileMarkers(result.body, result.attachments ?? []).map((segment, index) => segment.kind === 'chip' ? <MessageFileChip key={index} attachment={segment.attachment} /> : <EntityAwareText key={index} text={segment.text} renderMarkdown={(text, key) => <MessageResponse key={key} className="text-[13px] [&_p]:text-[13px] [&_li]:text-[13px]">{text}</MessageResponse>} />)}</div>;
}
