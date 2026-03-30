"use client";

import {
  FileText, ExternalLink, Archive, MoreHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { AreaSelect } from '@/components/shared/area-select';
import { TagEditor } from '@/components/shared/tag-editor';
import { TaskPicker } from '@/components/shared/task-picker';
import { cn } from '@/lib/utils';
import type { NoteRecord } from '@/db/types';

/** Strip markdown syntax for plain-text previews */
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')    // italic
    .replace(/~~(.*?)~~/g, '$1')        // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // inline code
    .replace(/^\s*[-*+]\s+/gm, '')      // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')      // ordered list markers
    .replace(/^\s*>\s?/gm, '')          // blockquotes
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\n{2,}/g, ' ')            // collapse blank lines to space
    .trim();
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NoteRowProps {
  note: NoteRecord;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onArchive: (id: string) => void;
  onOpen?: (id: string) => void;
}

export function NoteRow({ note, onUpdate, onArchive, onOpen }: NoteRowProps) {
  const displayTitle = note.title || stripMarkdown(note.body.split('\n')[0]).slice(0, 80);
  const rawPreview = note.title ? note.body : note.body.split('\n').slice(1).join('\n');
  const bodyPreview = rawPreview ? stripMarkdown(rawPreview) : '';

  return (
    <div
      className={cn(
        'group flex items-start gap-1.5 px-2 py-2 rounded-lg transition-all border border-transparent cursor-pointer',
        'hover:bg-card hover:border-border',
      )}
      onClick={() => onOpen?.(note.id)}
    >
      {/* Icon */}
      <div className="mt-0.5 text-muted-foreground/50 flex-shrink-0">
        {note.url ? <ExternalLink size={14} /> : <FileText size={14} />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium leading-tight line-clamp-1">{displayTitle}</p>
        {bodyPreview && (
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{bodyPreview}</p>
        )}

        {/* Metadata row */}
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <AreaSelect
            value={note.area_id}
            onChange={(areaId) => onUpdate(note.id, 'area_id', areaId)}
          />

          <span className="text-[8.5px] text-muted-foreground">
            {formatRelativeDate(note.created_at)}
          </span>

          <TaskPicker
            value={note.task_id}
            onChange={(taskId) => onUpdate(note.id, 'task_id', taskId)}
          />

          {note.url && (
            <a
              href={note.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 text-[8.5px] text-primary/60 font-bold uppercase tracking-wider hover:text-primary"
            >
              <ExternalLink size={8} /> Link
            </a>
          )}

          <TagEditor
            tags={note.context_tags ?? []}
            onChange={(tags) => onUpdate(note.id, 'context_tags', tags)}
          />
        </div>
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {note.url && (
              <DropdownMenuItem asChild className="text-xs">
                <a href={note.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} className="mr-2" /> Open link
                </a>
              </DropdownMenuItem>
            )}
            {note.url && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => onArchive(note.id)}
              className="text-xs text-destructive"
            >
              <Archive size={12} className="mr-2" /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
