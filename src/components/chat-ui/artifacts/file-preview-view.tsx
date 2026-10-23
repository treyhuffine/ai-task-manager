'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { File } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { filePreviewUrl, fileSizeLabel, type FilePreviewSource } from '@/lib/files/preview-types';
import type { FilePreviewData } from '@/lib/files/preview';
import { AgentResponse } from '@/components/chat-ui/messages/agent-response';
import { Button } from '@/components/ui/button';
import { FileSkeleton } from '@/components/executions/skeletons';
import { useSessionCookieReady } from '@/hooks/use-session-cookie-ready';

export function FilePreviewView({ source, name }: { source: FilePreviewSource; name: string }) {
  const { data, isPending, error } = useQuery(trpc.filePreviews.read.queryOptions(source, { staleTime: 30_000 }));
  if (isPending) return <FileSkeleton variant="prose" />;
  if (error) return <p role="status" className="p-6 text-sm text-muted-foreground">{error.message}</p>;
  if (!data) return null;
  if (data.kind === 'audio' || data.kind === 'video') return <MediaView source={source} kind={data.kind} url={data.url} />;
  if (data.kind === 'table') return <TableView data={data} />;
  if (data.kind === 'archive') return <div className="h-full overflow-auto p-4">
    <p className="mb-3 text-xs text-muted-foreground">{data.entries.length} entries · {fileSizeLabel(data.size)}{data.truncated && ' · Listing limited'}</p>
    <table className="w-full text-left text-xs"><caption className="sr-only">Archive contents</caption><thead><tr className="border-b border-border"><th className="py-2 font-medium">Name</th><th className="py-2 text-right font-medium">Size</th></tr></thead><tbody>{data.entries.map((entry, index) => <tr key={index} className="border-b border-border/50"><td className="max-w-0 break-words py-2 pr-3 font-mono">{entry.name}</td><td className="whitespace-nowrap py-2 text-right text-muted-foreground">{entry.directory ? 'Folder' : fileSizeLabel(entry.size)}</td></tr>)}</tbody></table>
    {!data.entries.length && <p className="text-sm text-muted-foreground">This archive is empty.</p>}
    {data.truncated && <p role="status" className="mt-3 text-xs text-muted-foreground">Showing part of this archive. Download it to see all entries.</p>}
  </div>;
  if (data.kind === 'document') return <iframe className="h-full w-full border-0 bg-white" title="Document preview" sandbox="" referrerPolicy="no-referrer" srcDoc={documentHtml(data.html)} />;
  if (data.kind === 'slides') return <div className="h-full overflow-auto bg-muted/30 p-4">
    <p className="mb-4 text-xs text-muted-foreground">Slide content preview. Download the presentation for its original layout.</p>
    {data.slides.map((slide, index) => <section key={index} aria-label={slide.title} className="mx-auto mb-4 min-h-48 max-w-3xl rounded-lg border border-border bg-background p-6 shadow-sm"><h2 className="mb-4 text-sm font-semibold">{slide.title}</h2><p className="whitespace-pre-wrap text-sm leading-relaxed">{slide.text || 'This slide has no text.'}</p></section>)}
    {!data.slides.length && <p className="text-sm text-muted-foreground">No slides could be read. Download the presentation to open it.</p>}
    {data.truncated && <p role="status" className="text-xs text-muted-foreground">Showing part of this presentation.</p>}
  </div>;
  if (data.kind === 'text') return <TextView data={data} source={source} />;
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><File aria-hidden className="size-8 text-muted-foreground" /><p className="max-w-full break-words text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{fileSizeLabel(data.size)}</p><p role="status" className="max-w-sm text-sm text-muted-foreground">{data.kind === 'file' ? data.reason : ''}</p></div>;
}

function MediaView({ source, kind, url }: { source: FilePreviewSource; kind: 'video' | 'audio'; url?: string }) {
  const cookieReady = useSessionCookieReady();
  const ref = useRef<HTMLMediaElement | null>(null);
  const [failed, setFailed] = useState(false);
  const props = { src: url ?? filePreviewUrl(source), controls: true, preload: 'metadata', onError: () => setFailed(true) } as const;
  if (!cookieReady) return <FileSkeleton variant="prose" />;
  return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-auto p-4">
    {kind === 'video' ? <video {...props} ref={element => { ref.current = element; }} playsInline className="max-h-[calc(100%-5rem)] w-full min-h-0 object-contain" aria-label="Video player" />
      : <audio {...props} ref={element => { ref.current = element; }} className="w-full max-w-xl" aria-label="Audio player" />}
    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">Playback speed<select aria-label="Playback speed" defaultValue="1" className="rounded border border-border bg-background px-2 py-1 text-foreground" onChange={event => { if (ref.current) ref.current.playbackRate = Number(event.target.value); }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
    {failed && <p role="status" className="max-w-md shrink-0 text-center text-sm text-muted-foreground">This browser cannot play this file or the file is unavailable. Download it to open it in another player.</p>}
  </div>;
}

function TableView({ data }: { data: Extract<FilePreviewData, { kind: 'table' }> }) {
  const [sheet, setSheet] = useState(0);
  const [source, setSource] = useState(false);
  const current = data.sheets[sheet] ?? data.sheets[0];
  const columns = current?.rows.reduce((max, row) => Math.max(max, row.length), 0) ?? 0;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
      {data.sheets.length > 1 && <label className="flex min-w-0 items-center gap-2">Sheet<select aria-label="Sheet" value={sheet} onChange={event => setSheet(Number(event.target.value))} className="min-w-0 max-w-48 rounded border border-border bg-background p-1">{data.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>}
      {data.source !== undefined && <div role="group" aria-label="Table view" className="flex gap-1"><Button variant="ghost" size="xs" aria-pressed={!source} onClick={() => setSource(false)}>Table</Button><Button variant="ghost" size="xs" aria-pressed={source} onClick={() => setSource(true)}>Source</Button></div>}
      <span className="text-muted-foreground">{current?.rows.length ?? 0} rows · {columns} columns</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">{source ? <pre tabIndex={0} aria-label="File source" className="whitespace-pre p-4 font-mono text-xs">{data.source}</pre>
      : !current?.rows.length ? <p className="p-4 text-sm text-muted-foreground">{data.truncated ? 'No cells in the preview range.' : 'This sheet is empty.'}</p>
        : <table className="w-full border-collapse text-left text-xs"><caption className="sr-only">{current.name}</caption><thead className="sticky top-0 bg-muted"><tr><th className="border-b border-r border-border px-3 py-2"><span className="sr-only">Row</span></th>{Array.from({ length: columns }, (_, index) => <th key={index} className="border-b border-r border-border px-3 py-2 font-medium">{columnName(index + (current.columnOffset ?? 0))}</th>)}</tr></thead><tbody>{current.rows.map((row, index) => <tr key={index} className="even:bg-muted/20"><th scope="row" className="border-b border-r border-border bg-muted/40 px-3 py-2 text-right font-normal text-muted-foreground">{index + 1 + (current.rowOffset ?? 0)}</th>{row.map((cell, column) => <td key={column} className="max-w-80 min-w-24 whitespace-pre-wrap break-words border-b border-r border-border px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table>}
    </div>
    {data.truncated && <p role="status" className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">Showing part of this workbook. Download it to see all cells and sheets.</p>}
  </div>;
}

function columnName(index: number): string { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }
function documentHtml(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{max-width:48rem;margin:auto;padding:2rem;font:16px/1.6 system-ui;color:#171717;overflow-wrap:anywhere}img,table{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.4rem}pre{white-space:pre-wrap}a{color:#1555a0}</style></head><body>${html}</body></html>`;
}

function TextView({ data, source }: { data: Extract<FilePreviewData, { kind: 'text' }>; source: FilePreviewSource }) {
  const [raw, setRaw] = useState(false);
  return <div className="flex h-full min-h-0 flex-col">{data.markdown && <div className="flex shrink-0 gap-1 border-b border-border p-2"><Button variant="ghost" size="xs" aria-pressed={!raw} onClick={() => setRaw(false)}>Rendered</Button><Button variant="ghost" size="xs" aria-pressed={raw} onClick={() => setRaw(true)}>Source</Button></div>}<div className="min-h-0 flex-1 overflow-auto">{data.markdown && !raw ? <div className="mx-auto max-w-3xl p-6"><AgentResponse mode="static" text={data.content} sessionId={source.kind === 'session' ? source.sessionId : undefined} fileBasePath={source.kind === 'session' ? source.path : undefined} /></div> : <pre tabIndex={0} aria-label="File source" className="whitespace-pre p-4 font-mono text-xs">{data.content}</pre>}</div>{data.truncated && <p role="status" className="shrink-0 border-t border-border p-3 text-xs text-muted-foreground">Showing part of this document. Download it to read everything.</p>}</div>;
}
