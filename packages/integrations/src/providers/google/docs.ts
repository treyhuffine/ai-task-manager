/**
 * The `google_docs` toolkit. The Docs API lives on its own host (`docs.googleapis.com`), so
 * actions use absolute URLs (the http client resolves absolute paths directly). Shares the
 * Google connection; reads need `documents.readonly`, writes need `documents`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { GOOGLE_SCOPES } from './provider';

const DOCS = 'https://docs.googleapis.com/v1/documents';

interface RawDoc {
  documentId?: string;
  title?: string;
  body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> };
}

/** Flatten a Docs document body into plain text. */
function docText(doc: RawDoc): string {
  const out: string[] = [];
  for (const el of doc.body?.content ?? []) {
    for (const e of el.paragraph?.elements ?? []) {
      if (e.textRun?.content) out.push(e.textRun.content);
    }
  }
  return out.join('');
}

export const googleDocs = defineToolkit({
  id: 'google_docs',
  providerId: 'google',
  displayName: 'Google Docs',
  actions: [
    httpAction({
      id: 'google_docs.get_document',
      description: 'Get a Google Doc’s title and plain-text content by document id.',
      scopes: [GOOGLE_SCOPES.documentsReadonly],
      input: z.object({ documentId: z.string() }),
      request: (i) => ({ method: 'GET', path: `${DOCS}/${encodeURIComponent(i.documentId)}` }),
      output: (raw) => {
        const d = raw as RawDoc;
        return { documentId: d.documentId, title: d.title, text: docText(d) };
      },
    }),

    httpAction({
      id: 'google_docs.create_document',
      description: 'Create a new Google Doc with a title.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.documents],
      input: z.object({ title: z.string() }),
      request: (i) => ({ method: 'POST', path: DOCS, body: { title: i.title } }),
      output: (raw) => {
        const d = raw as RawDoc;
        return { documentId: d.documentId, title: d.title };
      },
    }),

    httpAction({
      id: 'google_docs.append_text',
      description: 'Append text to the end of an existing Google Doc.',
      mutating: true,
      risk: 'medium',
      scopes: [GOOGLE_SCOPES.documents],
      input: z.object({ documentId: z.string(), text: z.string() }),
      request: (i) => ({
        method: 'POST',
        path: `${DOCS}/${encodeURIComponent(i.documentId)}:batchUpdate`,
        body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: i.text } }] },
      }),
      output: () => ({ updated: true }),
    }),
  ],
});
