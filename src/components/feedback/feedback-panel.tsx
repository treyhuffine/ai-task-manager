'use client';

import { useId, useRef, useState, type ClipboardEvent } from 'react';
import Image from 'next/image';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowUpRight,
  Download,
  ImagePlus,
  Loader2,
  Paperclip,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tip';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { useHomeDocumentScope, useOptionalHomeContext } from '@/components/home/home-context';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import { HOTKEYS, matchesHotkey } from '@/constants/commands';
import { apiErrorText } from '@/lib/api/client';
import { uploadAttachment } from '@/lib/attachments/client';
import { attachmentUrl } from '@/lib/attachments/view';
import { homeDocumentKey } from '@/lib/home/document-scope';
import {
  MAX_FEEDBACK_FILES,
  MAX_FEEDBACK_FILE_BYTES,
  MAX_FEEDBACK_TOTAL_BYTES,
  MAX_FEEDBACK_MESSAGE,
  type FeedbackKind,
} from '@/lib/feedback/schema';
import { trpc } from '@/lib/trpc/client';
import {
  getFeedbackDraft,
  editFeedbackDraft,
  patchFeedbackDraft,
  resetFeedbackDraft,
  useFeedbackDraft,
} from './feedback-draft';

const kinds: { id: FeedbackKind; label: string }[] = [
  { id: 'feedback', label: 'Feedback' },
  { id: 'bug', label: 'Bug' },
  { id: 'question', label: 'Question' },
];
export function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const id = useId();
  const dashboard = useOptionalDashboard();
  const home = useOptionalHomeContext();
  const scope = useHomeDocumentScope();
  const key = `ri:${homeDocumentKey('feedback', 'draft', scope)}`;
  const draft = useFeedbackDraft(key);
  const viewport = useViewportTier();
  const filesRef = useRef<HTMLInputElement>(null);
  const [copiedBody, setCopiedBody] = useState('');
  const prepare = useMutation({
    ...trpc.feedback.preparePublicIssue.mutationOptions(),
    retry: false,
  });
  if (!draft) return null;
  const { value } = draft;
  const busy = draft.opening || draft.uploading;
  const patch = (change: Parameters<typeof editFeedbackDraft>[1]) => editFeedbackDraft(key, change);
  const handleFiles = async (files: FileList | File[]) => {
    const current = getFeedbackDraft(key);
    if (current.opening) return;
    if (current.uploading) {
      patchFeedbackDraft(key, {
        error:
          'That paste was not added while files are uploading. Try again when the upload finishes.',
      });
      return;
    }
    const candidates = Array.from(files);
    if (!candidates.length) return;
    const remaining = MAX_FEEDBACK_FILES - current.value.attachments.length;
    const total =
      current.value.attachments.reduce((sum, file) => sum + file.size, 0) +
      candidates.reduce((sum, file) => sum + file.size, 0);
    let error: string | null = null;
    if (candidates.length > remaining)
      error = `Attach up to ${MAX_FEEDBACK_FILES} files. Remove a file before adding more.`;
    else if (candidates.some((file) => file.size === 0 || file.size > MAX_FEEDBACK_FILE_BYTES))
      error = 'Each file must be nonempty and 10 MB or less.';
    else if (total > MAX_FEEDBACK_TOTAL_BYTES) error = 'Attachments must total 20 MB or less.';
    if (error) {
      patchFeedbackDraft(key, { error });
      return;
    }
    // This synchronous reservation also blocks image pastes before React renders again.
    patchFeedbackDraft(key, { uploading: true, error: null });
    const uploads = await Promise.allSettled(
      candidates.map((file) => uploadAttachment(file, file.name)),
    );
    const latest = getFeedbackDraft(key);
    const uploaded = uploads.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
    patchFeedbackDraft(key, {
      uploading: false,
      value: {
        ...latest.value,
        attachments: [...latest.value.attachments, ...uploaded],
      },
      githubIssue: undefined,
      error: uploads.some((item) => item.status === 'rejected')
        ? 'Some files could not upload. The others are attached. Try adding the missing files again.'
        : latest.error,
    });
  };
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.items).flatMap((item) => {
      const file = item.kind === 'file' && item.type.startsWith('image/') ? item.getAsFile() : null;
      return file ? [file] : [];
    });
    if (images.length) {
      event.preventDefault();
      void handleFiles(images);
    }
  };
  const handleContinue = async () => {
    const current = getFeedbackDraft(key);
    if (current.opening || current.uploading || !current.value.message.trim()) return;
    const tab = window.open('about:blank', '_blank');
    patchFeedbackDraft(key, { opening: true, error: null });
    try {
      const issue =
        current.githubIssue ??
        (await prepare.mutateAsync({
          ...current.value,
          message: current.value.message.trim(),
          diagnostics: current.value.includeDiagnostics
            ? {
                view: dashboard?.activeView.kind,
                viewport,
                theme: dashboard?.theme,
                surface: window.riDesktop ? 'desktop' : 'web',
                homeKind: home?.home.kind,
                userAgent: navigator.userAgent,
              }
            : undefined,
        }));
      patchFeedbackDraft(key, {
        opening: false,
        githubIssue: issue,
        error: tab
          ? null
          : 'The GitHub draft is ready. Use the link below to open it if your browser blocked the new tab.',
      });
      if (tab) {
        tab.opener = null;
        tab.location.href = issue.githubIssueUrl;
      }
    } catch (error) {
      tab?.close();
      patchFeedbackDraft(key, {
        opening: false,
        error: `GitHub could not open. Your draft is kept. ${apiErrorText(error)}`,
      });
    }
  };
  const close = (
    <Tip label="Keep your draft and return to work">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Close feedback"
        onClick={onClose}
      >
        <X size={16} />
      </Button>
    </Tip>
  );
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h3 className="text-sm font-semibold">Feedback & bugs</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a public issue for the Ri team.
          </p>
        </div>
        {close}
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-4">
        <fieldset disabled={busy}>
          <legend className="sr-only">Feedback category</legend>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((kind) => (
              <label key={kind.id} className="cursor-pointer">
                <input
                  type="radio"
                  className="peer sr-only"
                  name={`${id}-kind`}
                  value={kind.id}
                  checked={value.kind === kind.id}
                  onChange={() => patch({ kind: kind.id })}
                />
                <span className="block rounded-full border border-transparent px-2.5 py-1.5 text-xs text-muted-foreground peer-checked:border-border peer-checked:bg-muted peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-60">
                  {kind.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void handleFiles(event.dataTransfer.files);
          }}
        >
          <label htmlFor={`${id}-message`} className="sr-only">
            Feedback details
          </label>
          <Textarea
            id={`${id}-message`}
            autoFocus
            rows={5}
            maxLength={MAX_FEEDBACK_MESSAGE}
            value={value.message}
            disabled={draft.opening}
            onChange={(event) => patch({ message: event.target.value })}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (matchesHotkey(event, HOTKEYS.submitCaptureModified)) {
                event.preventDefault();
                void handleContinue();
              }
            }}
            placeholder={
              value.kind === 'bug'
                ? 'What happened? What were you expecting?'
                : value.kind === 'question'
                  ? 'What are you trying to figure out?'
                  : 'What would make Ri more useful for you?'
            }
            className="h-36 min-h-24 max-h-48 overflow-y-auto [field-sizing:fixed] text-base md:text-sm"
          />
        </div>
        {value.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {value.attachments.map((file) => (
              <div
                key={file.fileName}
                className="relative flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 p-2"
              >
                <a
                  href={attachmentUrl(file.fileName)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-2 text-xs"
                  aria-label={`View ${file.originalName}`}
                >
                  {file.mimeType.startsWith('image/') ? (
                    <Image
                      unoptimized
                      width={36}
                      height={36}
                      src={attachmentUrl(file.fileName)}
                      alt=""
                      className="size-9 rounded border border-border/70 object-cover"
                    />
                  ) : (
                    <Paperclip size={18} className="mx-2 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{file.originalName}</span>
                </a>
                <Tip label="Save this file to add it to your GitHub issue">
                  <Button asChild variant="ghost" size="icon-xs">
                    <a
                      href={attachmentUrl(file.fileName)}
                      download={file.originalName}
                      aria-label={`Download ${file.originalName}`}
                    >
                      <Download size={13} />
                    </a>
                  </Button>
                </Tip>
                <Tip label={`Remove ${file.originalName}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={`Remove ${file.originalName}`}
                    onClick={() =>
                      patch({
                        attachments: value.attachments.filter(
                          (item) => item.fileName !== file.fileName,
                        ),
                      })
                    }
                  >
                    <X size={13} />
                  </Button>
                </Tip>
              </div>
            ))}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-info`}
              checked={value.includeDiagnostics}
              disabled={busy}
              onCheckedChange={(checked) => patch({ includeDiagnostics: checked === true })}
            />
            <label htmlFor={`${id}-info`} className="text-xs">
              Include app & view info
            </label>
          </div>
          <details className="mt-1.5 pl-6 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">See what is included</summary>
            <p className="mt-1 leading-relaxed">
              Ri version, server platform, browser, screen size, theme, and current view. Your
              chats, notes, and tasks are not included.
            </p>
          </details>
        </div>
        {draft.githubIssue && (
          <div role="status" className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
            <p className="font-medium">Finish on GitHub</p>
            <p className="mt-1 text-muted-foreground">
              Review your draft and publish the issue on GitHub. Opening the draft does not submit
              your feedback.
            </p>
            {draft.githubIssue.needsBodyPaste && (
              <p className="mt-2 text-muted-foreground">
                This report is too long to prefill. Copy the full report into the GitHub draft.
              </p>
            )}
            {draft.githubIssue.needsBodyPaste && (
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(draft.githubIssue!.body);
                      setCopiedBody(draft.githubIssue!.body);
                    } catch {
                      patchFeedbackDraft(key, {
                        error: 'Copying was not available. Download the report instead.',
                      });
                    }
                  }}
                >
                  {copiedBody === draft.githubIssue.body ? 'Copied' : 'Copy full report'}
                </button>
                <a
                  download="ri-feedback.md"
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(draft.githubIssue.body)}`}
                  className="underline underline-offset-4"
                >
                  Download report
                </a>
              </div>
            )}
          </div>
        )}
        {draft.error && (
          <div
            role="alert"
            className="flex gap-2 rounded-lg bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{draft.error}</span>
          </div>
        )}
        {draft.storageError && (
          <p role="alert" className="text-xs text-destructive">
            This draft could not be saved on this device. Keep this panel open until you send it.
          </p>
        )}
      </div>
      <div className="shrink-0 space-y-3 border-t border-border/60 px-5 py-4">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Your feedback will be public. Review and publish it on GitHub.
        </p>
        <div className="flex items-center justify-between gap-2">
          <input
            ref={filesRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <Tip label="Paste an image, drop a file, or choose up to 5 files. 10 MB each, 20 MB total.">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2 text-xs"
              disabled={busy || value.attachments.length >= MAX_FEEDBACK_FILES}
              onClick={() => filesRef.current?.click()}
            >
              {draft.uploading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <ImagePlus size={15} />
              )}
              <span>{draft.uploading ? 'Uploading...' : 'Attach'}</span>
            </Button>
          </Tip>
          {draft.githubIssue && !busy ? (
            <Button asChild size="sm" className="text-xs">
              <a href={draft.githubIssue.githubIssueUrl} target="_blank" rel="noopener noreferrer">
                <ArrowUpRight size={14} />
                Continue on GitHub
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="text-xs"
              disabled={!value.message.trim() || busy}
              onClick={() => void handleContinue()}
            >
              {draft.opening ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowUpRight size={14} />
              )}
              <span>{draft.opening ? 'Opening...' : 'Continue on GitHub'}</span>
            </Button>
          )}
        </div>
        {value.attachments.length > 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Files are kept in Ri. Download them above and add them to the GitHub issue before
            publishing.
          </p>
        )}
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <p>
            {draft.storageError
              ? 'Keep this panel open to keep your draft.'
              : 'You can close this panel. Your draft is kept on this device.'}
          </p>
          {draft.githubIssue && (
            <button
              type="button"
              className="shrink-0 underline underline-offset-4"
              onClick={() => resetFeedbackDraft(key)}
            >
              Start new feedback
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
