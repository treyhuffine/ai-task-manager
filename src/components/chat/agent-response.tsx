'use client';

import { useMemo, type ReactNode } from 'react';
import type { Components } from 'streamdown';
import { EntityAwareText } from '@/components/ai-elements/entity-reference';
import { MessageResponse } from '@/components/ai-elements/message';
import { rewriteReplyImages } from '@/lib/sessions/reply-image-urls';
import { HTML_PREVIEW_TAG, htmlPreviewTarget, rewriteLocalHtml } from '@/lib/sessions/reply-html';
import { HtmlPreviewLink } from './html-preview-link';
import { ImagePreviewCard } from './image-preview-card';

const htmlTags = { [HTML_PREVIEW_TAG]: ['href'] };
const literalTags = [HTML_PREVIEW_TAG];

export function AgentResponse({ text, sessionId }: { text: string; sessionId?: string }) {
  const components = useMemo<Components>(() => ({
    img: ({ src, alt }) => typeof src === 'string' ? <ImagePreviewCard src={src} alt={alt} /> : null,
    [HTML_PREVIEW_TAG]: ({ href, children }) => {
      const path = htmlPreviewTarget(typeof href === 'string' ? href : undefined);
      return path && sessionId
        ? <HtmlPreviewLink sessionId={sessionId} path={path}>{children as ReactNode}</HtmlPreviewLink>
        : <span>{children as ReactNode}</span>;
    },
  }), [sessionId]);
  return (
    <EntityAwareText
      text={rewriteLocalHtml(rewriteReplyImages(text, sessionId), sessionId)}
      renderMarkdown={(markdown, key) => (
        <MessageResponse key={key} components={components} allowedTags={htmlTags} literalTagContent={literalTags} className="text-[12.5px] [&_p]:text-[12.5px] [&_li]:text-[12.5px] [&_code]:text-[11px]">
          {markdown}
        </MessageResponse>
      )}
    />
  );
}
