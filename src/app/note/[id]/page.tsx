'use client';

import { use, useEffect, useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Trash2, MoreHorizontal, ExternalLink, Archive } from 'lucide-react';
import { NoteEditor } from '@/components/editor/rich-editor';
import { useNote, useUpdateNote, useDeleteNote } from '@/hooks/use-notes';
import { SlideoutChat, useDocumentChat } from '@/components/ai-elements/slideout-chat';
import { AreaSelect } from '@/components/shared/area-select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/db/types';

export default function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: noteId } = use(params);
  const router = useRouter();
  const { data: note } = useNote(noteId);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const chat = useDocumentChat('note', note ?? null);
  const aiBusy = chat.status === 'streaming' || chat.status === 'submitted';

  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAttachmentsRef = useRef<Attachment[]>([]);

  const handleAttachment = useCallback((attachment: Attachment) => {
    pendingAttachmentsRef.current = [...pendingAttachmentsRef.current, attachment];
  }, []);

  // Debounced save
  const handleTitleChange = useCallback(
    (title: string) => {
      if (!noteId) return;
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => {
        updateNote.mutate({ id: noteId, title });
      }, 500);
    },
    [noteId, updateNote],
  );

  const handleBodyChange = useCallback(
    (body: string) => {
      if (!noteId) return;
      const text = body.replace(/[#*_~`>\-\[\]()]/g, '').trim();
      setWordCount(text ? text.split(/\s+/).length : 0);
      setCharCount(body.length);

      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      bodyTimerRef.current = setTimeout(() => {
        const attachments = pendingAttachmentsRef.current;
        updateNote.mutate({
          id: noteId,
          body,
          ...(attachments.length > 0 ? { attachments } : {}),
        });
      }, 500);
    },
    [noteId, updateNote],
  );

  // Initialize counts when note loads
  useEffect(() => {
    if (note) {
      const text = note.body.replace(/[#*_~`>\-\[\]()]/g, '').trim();
      setWordCount(text ? text.split(/\s+/).length : 0);
      setCharCount(note.body.length);
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAreaChange = useCallback(
    (areaId: string | null) => {
      if (!noteId) return;
      updateNote.mutate({ id: noteId, areaId: areaId });
    },
    [noteId, updateNote],
  );

  const foldedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFoldedHeadingsChange = useCallback(
    (folded: string[]) => {
      if (!noteId) return;
      if (foldedTimerRef.current) clearTimeout(foldedTimerRef.current);
      foldedTimerRef.current = setTimeout(() => {
        updateNote.mutate({ id: noteId, foldedHeadings: folded });
      }, 400);
    },
    [noteId, updateNote],
  );

  const handleArchive = useCallback(() => {
    if (!noteId) return;
    updateNote.mutate({ id: noteId, status: 'archived' });
    router.push('/');
  }, [noteId, updateNote, router]);

  const handleDelete = useCallback(() => {
    if (!noteId) return;
    deleteNote.mutate(noteId);
    router.push('/');
  }, [noteId, deleteNote, router]);

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current);
      if (foldedTimerRef.current) clearTimeout(foldedTimerRef.current);
    };
  }, []);

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/');
  }, [router]);

  // Escape → back to main app (skips if another handler already consumed it)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        el.blur();
        return;
      }
      goBack();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goBack]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      {/* Content + Chat */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-3xl mx-auto px-6">
            {/* Header */}
            <div className="flex items-center justify-between h-11 sticky top-0 z-10 bg-background/80 backdrop-blur-sm">
              <button
                onClick={goBack}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                aria-label="Back"
              >
                <ChevronLeft size={16} />
                <span className="text-xs">Back</span>
              </button>

              <div className="flex items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {note?.url && (
                      <>
                        <DropdownMenuItem asChild className="text-xs">
                          <a href={note.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={12} className="mr-2" /> Open link
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem onClick={handleArchive} className="text-xs">
                      <Archive size={12} className="mr-2" /> Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDelete} className="text-xs text-destructive">
                      <Trash2 size={12} className="mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {note ? (
              <>
                <div className="pt-6 flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wide text-muted-foreground/60 uppercase">
                    Note
                  </span>
                  <span className="text-muted-foreground/30">&middot;</span>
                  <AreaSelect value={note.areaId} onChange={handleAreaChange} />
                </div>
                <div className="pb-16">
                  <NoteEditor
                    key={note.id}
                    title={note.title ?? ''}
                    body={note.body}
                    onTitleChange={handleTitleChange}
                    onBodyChange={handleBodyChange}
                    onAttachment={handleAttachment}
                    foldedHeadings={note.foldedHeadings ?? []}
                    onFoldedHeadingsChange={handleFoldedHeadingsChange}
                    autoFocusTitle={!note.title && note.body.trim().length === 0}
                    disabled={aiBusy}
                    hideFooter
                    metadata={
                      <p className="text-[10px] text-muted-foreground/50 mt-1">
                        Created{' '}
                        {new Date(note.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {note.updatedAt !== note.createdAt && (
                          <>
                            {' '}
                            &middot; Edited{' '}
                            {new Date(note.updatedAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </>
                        )}
                        <>
                          {' '}
                          &middot; {wordCount} words &middot; {charCount} chars
                        </>
                      </p>
                    }
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                Loading...
              </div>
            )}
          </div>
        </div>

        <SlideoutChat slideoutWidth={9999} contextLabel="this note" chat={chat} disabled={!note} />
      </div>
    </div>
  );
}
