'use client';

import { useMemo, type ReactNode } from 'react';
import type { Components } from 'streamdown';
import { EntityAwareText } from '@/components/ai-elements/entity-reference';
import { MessageResponse } from '@/components/ai-elements/message';
import { rewriteLocalImages } from '@/lib/sessions/reply-image-urls';
import { HTML_PREVIEW_TAG, htmlPreviewTarget, rewriteLocalHtml } from '@/lib/sessions/reply-html';
import { PDF_PREVIEW_TAG, pdfPreviewTarget, rewriteLocalPdfs, sessionPdfUrl } from '@/lib/sessions/reply-pdf';
import { HtmlPreviewLink } from '@/components/chat-ui/artifacts/html-preview-link';
import { ImagePreviewCard } from '@/components/chat-ui/artifacts/image-preview-card';
import { PdfPreviewCard } from '@/components/chat-ui/artifacts/pdf-preview-card';

const htmlTags = { [HTML_PREVIEW_TAG]: ['href'], [PDF_PREVIEW_TAG]: ['href'] };
const literalTags = [HTML_PREVIEW_TAG, PDF_PREVIEW_TAG];

export function AgentResponse({ text, sessionId }: { text: string; sessionId?: string }) {
  const components = useMemo<Components>(() => ({
    img: ({ src, alt }) => typeof src === 'string' ? <ImagePreviewCard src={src} alt={alt} /> : null,
    [HTML_PREVIEW_TAG]: ({ href, children }) => {
      const path = htmlPreviewTarget(typeof href === 'string' ? href : undefined);
      return path && sessionId
        ? <HtmlPreviewLink sessionId={sessionId} path={path}>{children as ReactNode}</HtmlPreviewLink>
        : <span>{children as ReactNode}</span>;
    },
    [PDF_PREVIEW_TAG]: ({ href, children }) => {
      const path = pdfPreviewTarget(typeof href === 'string' ? href : undefined);
      return path && sessionId
        ? <PdfPreviewCard src={sessionPdfUrl(sessionId, path)} name={path.split('/').at(-1) || path} source={path} description={typeof children === 'string' ? children : undefined} />
        : <span>{children as ReactNode}</span>;
    },
  }), [sessionId]);
  return (
    <EntityAwareText
      text={rewriteLocalPdfs(rewriteLocalHtml(rewriteLocalImages(text, sessionId), sessionId), sessionId)}
      renderMarkdown={(markdown, key) => (
        <MessageResponse key={key} components={components} allowedTags={htmlTags} literalTagContent={literalTags} className="text-[12.5px] [&_p]:text-[12.5px] [&_li]:text-[12.5px] [&_code]:text-[11px]">
          {markdown}
        </MessageResponse>
      )}
    />
  );
}
