/** Browser-safe file classification, shared by previews and local reply references. */
export type FilePreviewSource =
  | { kind: 'session'; sessionId: string; path: string }
  | { kind: 'attachment'; fileName: string; media?: 'audio' | 'video' };

export function filePreviewKind(name: string) {
  const ext = name.split('.').at(-1)?.toLowerCase();
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext ?? '')) return 'video';
  if (['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac'].includes(ext ?? '')) return 'audio';
  if (['csv', 'tsv', 'xlsx', 'xls', 'ods'].includes(ext ?? '')) return 'table';
  if (['docx', 'odt', 'rtf'].includes(ext ?? '')) return 'document';
  if (['pptx', 'odp'].includes(ext ?? '')) return 'slides';
  if (/\.(?:zip|tar|tar\.gz|tgz|gz)$/i.test(name)) return 'archive';
  return 'file';
}

export function filePreviewUrl(source: FilePreviewSource, download = false, name?: string): string {
  if (source.kind === 'attachment') return `/api/attachments/${encodeURIComponent(source.fileName)}${download ? `?download=1${name ? `&name=${encodeURIComponent(name)}` : ''}` : source.media ? `?media=${source.media}` : ''}`;
  return `/api/sessions/${encodeURIComponent(source.sessionId)}/${download ? 'download' : 'media'}?path=${encodeURIComponent(source.path)}`;
}

export function filePreviewMime(name: string): string {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

export function fileSizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}
