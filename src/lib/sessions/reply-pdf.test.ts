import { describe, expect, it } from 'vitest';
import {
  PDF_PREVIEW_TAG,
  attachmentPdfUrl,
  isLocalPdfTarget,
  pdfDownloadUrl,
  pdfPageUrl,
  pdfPreviewHref,
  pdfPreviewTarget,
  pdfThumbnailUrl,
  pdfViewerUrl,
  rewriteLocalPdfs,
  sessionPdfUrl,
} from './reply-pdf';

const card = (target: string, label = target.split('/').at(-1)) => `<${PDF_PREVIEW_TAG} href="${pdfPreviewHref(target)}">${label}</${PDF_PREVIEW_TAG}>`;

describe('rewriteLocalPdfs', () => {
  it('turns the ways agents name a local PDF into cards', () => {
    expect(rewriteLocalPdfs('[The board deck](/tmp/board.pdf)', 's1')).toBe(card('/tmp/board.pdf', 'The board deck'));
    expect(rewriteLocalPdfs('Saved to `out/report.pdf`.', 's1')).toBe(`Saved to ${card('out/report.pdf')}.`);
    expect(rewriteLocalPdfs('Wrote /tmp/q3.pdf, then stopped.', 's1')).toBe(`Wrote ${card('/tmp/q3.pdf')}, then stopped.`);
    expect(rewriteLocalPdfs('Open "./docs/My Spec.pdf" next', 's1')).toBe(`Open ${card('./docs/My Spec.pdf')} next`);
  });

  it('leaves web links, code blocks, prose filenames and other chats alone', () => {
    const web = '[Paper](https://example.com/paper.pdf) and example.com/a.pdf';
    expect(rewriteLocalPdfs(web, 's1')).toBe(web);
    const code = '```\ncat /tmp/board.pdf\n```';
    expect(rewriteLocalPdfs(code, 's1')).toBe(code);
    expect(rewriteLocalPdfs('saved board.pdf', 's1')).toBe('saved board.pdf');
    expect(rewriteLocalPdfs('[Deck](/tmp/board.pdf)', null)).toBe('[Deck](/tmp/board.pdf)');
  });

  it('escapes a label so it stays text', () => {
    expect(rewriteLocalPdfs('[<b>Q3</b> & "notes"](/tmp/q3.pdf)', 's1')).toContain('&lt;b&gt;Q3&lt;/b&gt; &amp; &quot;notes&quot;');
  });
});

describe('PDF references and URLs', () => {
  it('reads back only its own local PDF references', () => {
    expect(pdfPreviewTarget(pdfPreviewHref('/tmp/a b (1).pdf'))).toBe('/tmp/a b (1).pdf');
    expect(pdfPreviewTarget(pdfPreviewHref('https://example.com/x.pdf'))).toBeNull();
    expect(pdfPreviewTarget('#ri-html=%2Ftmp%2Fx.pdf')).toBeNull();
    expect(pdfPreviewTarget(undefined)).toBeNull();
    expect(isLocalPdfTarget('file:///tmp/x.pdf')).toBe(true);
    expect(isLocalPdfTarget('/tmp/x.pdf.txt')).toBe(false);
  });

  it('asks one URL for the thumbnail, a page or a download', () => {
    const src = sessionPdfUrl('chat 1', '/tmp/My Report.pdf');
    expect(src).toBe('/api/sessions/chat%201/pdf?path=%2Ftmp%2FMy%20Report.pdf');
    expect(pdfThumbnailUrl(src)).toBe(`${src}&thumbnail=1`);
    expect(pdfPageUrl(src, 3)).toBe(`${src}&page=3`);
    expect(pdfDownloadUrl(src)).toBe(`${src}&download=1`);
    const upload = attachmentPdfUrl('/api/attachments/01a.pdf', 'Board & plan.pdf');
    expect(upload).toBe('/api/attachments/01a.pdf?name=Board%20%26%20plan.pdf');
    expect(pdfThumbnailUrl(upload)).toBe(`${upload}&thumbnail=1`);
    // The viewer titles a document by its URL's last part.
    expect(pdfViewerUrl(src, 'My Report.pdf')).toBe('/api/sessions/chat%201/pdf/My%20Report.pdf?path=%2Ftmp%2FMy%20Report.pdf');
    expect(pdfViewerUrl('/api/attachments/01a.pdf', 'Board & plan.pdf')).toBe('/api/attachments/01a.pdf/Board%20%26%20plan.pdf');
  });
});
