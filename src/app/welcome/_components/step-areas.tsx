import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmojiPicker } from '@/components/shared/emoji-picker';
import { Layers, Plus, X, SmilePlus, ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WizardState, WizardUpdate } from './types';
import type { Attachment } from '@/db/types';
import { uploadAttachment } from '@/lib/attachments/client';

const PRESETS: WizardState['areas'] = [
  { name: 'Work', emoji: '💼', attachments: [] },
  { name: 'Personal', emoji: '🏡', attachments: [] },
  { name: 'Side Project', emoji: '🚀', attachments: [] },
];

/** Render the area's cover image: first image-like attachment wins. */
function coverSrc(attachments: Attachment[] | null | undefined): string | null {
  const first = attachments?.find((a) => a.mime_type.startsWith('image/'));
  return first ? `/api/attachments/${first.file_name}` : null;
}

export function StepAreas({
  state,
  update,
}: {
  state: WizardState;
  update: WizardUpdate;
}) {
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState<string | null>(null);
  const [newAttachment, setNewAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetNew = () => {
    setNewName('');
    setNewEmoji(null);
    setNewAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggle = (preset: WizardState['areas'][number]) => {
    update((s) => {
      const exists = s.areas.some((a) => a.name === preset.name);
      return {
        areas: exists
          ? s.areas.filter((a) => a.name !== preset.name)
          : [...s.areas, preset],
      };
    });
  };

  const addArea = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const emoji = newAttachment ? null : newEmoji;
    const attachments = newAttachment ? [newAttachment] : [];
    update((s) => {
      if (s.areas.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) return {};
      return { areas: [...s.areas, { name: trimmed, emoji, attachments }] };
    });
    resetNew();
  };

  const removeArea = (name: string) => {
    update((s) => ({ areas: s.areas.filter((a) => a.name !== name) }));
  };

  const onImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const attachment = await uploadAttachment(file);
      setNewAttachment(attachment);
      setNewEmoji(null);
    } catch (err) {
      console.error('[wizard] area image upload failed', err);
    } finally {
      setUploading(false);
    }
  };

  const isPreset = (name: string) => PRESETS.some((p) => p.name === name);
  const customAreas = state.areas.filter((a) => !isPreset(a.name));

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Layers className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Pick your areas</h2>
          <p className="text-sm text-muted-foreground">
            Distinct buckets of work — companies, clients, projects, life domains. Less is more to
            start; add more anytime.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Suggested</div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => {
            const selected = state.areas.some((a) => a.name === p.name);
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => toggle(p)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/50',
                )}
              >
                <span className="text-2xl">{p.emoji}</span>
                <span className="text-sm font-medium">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Add your own</div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onImageSelect}
            className="hidden"
          />

          {newAttachment ? (
            <div className="relative shrink-0">
              <img
                src={`/api/attachments/${newAttachment.file_name}`}
                alt="Area"
                className="size-10 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setNewAttachment(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                aria-label="Remove image"
              >
                <Trash2 className="size-2.5" />
              </button>
            </div>
          ) : (
            <>
              <EmojiPicker onSelect={(e) => setNewEmoji(e)}>
                <button
                  type="button"
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-md border',
                    newEmoji
                      ? 'border-border bg-accent/30 text-xl'
                      : 'border-dashed border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground',
                  )}
                  aria-label="Pick emoji"
                >
                  {newEmoji ?? <SmilePlus className="size-4" />}
                </button>
              </EmojiPicker>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50"
                aria-label="Upload image"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              </button>
            </>
          )}

          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addArea();
              }
            }}
            placeholder="Company, client, project…"
          />
          <Button type="button" variant="outline" onClick={addArea} disabled={!newName.trim()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>

        {customAreas.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {customAreas.map((a) => {
              const src = coverSrc(a.attachments);
              return (
                <span
                  key={a.name}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm"
                >
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      className="size-4 rounded-sm object-cover"
                    />
                  ) : a.emoji ? (
                    <span>{a.emoji}</span>
                  ) : null}
                  {a.name}
                  <button
                    type="button"
                    onClick={() => removeArea(a.name)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {state.areas.length === 0 && (
        <p className="text-sm text-muted-foreground">Select at least one to continue.</p>
      )}
    </div>
  );
}
