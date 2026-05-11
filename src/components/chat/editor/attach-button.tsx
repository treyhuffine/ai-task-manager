'use client';

/**
 * Paperclip button + file picker for chat composers.
 *
 * - Desktop (mouse / fine pointer): single click → file picker dialog.
 * - Mobile (coarse pointer / no hover): popover with three actions —
 *     · Take Photo (camera, accept=image/*, capture=environment)
 *     · Photo Library (accept=image/*)
 *     · Choose File (any)
 *
 * The popover surfaces the choice that mobile platforms otherwise
 * jam into one OS-level sheet — explicit options cut a step and let
 * the user pick the camera without scrolling past Recent Photos.
 *
 * Each picked file is forwarded one-by-one to `onPick`. The caller
 * typically routes them to `editor.uploadFile(...)`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, ImageIcon, Paperclip } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface AttachButtonProps {
  onPick: (file: File) => void;
  disabled?: boolean;
  /** Tooltip + a11y label. */
  title?: string;
  /** Icon size in px. Defaults to 13 to match other composer chips. */
  iconSize?: number;
  className?: string;
}

export function AttachButton({
  onPick,
  disabled,
  title = 'Attach file',
  iconSize = 13,
  className,
}: AttachButtonProps) {
  const [open, setOpen] = useState(false);
  const isCoarse = useCoarsePointer();

  const fileAnyRef = useRef<HTMLInputElement>(null);
  const filePhotoRef = useRef<HTMLInputElement>(null);
  const fileCameraRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) onPick(f);
  }, [onPick]);

  // Desktop: bypass the menu and just open the file picker. Coarse
  // pointer (touch screens, including iPad with Apple Pencil) gets
  // the explicit menu so users can hit Camera without an OS-level
  // sub-tap.
  const handleClick = () => {
    if (disabled) return;
    if (!isCoarse) {
      fileAnyRef.current?.click();
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <Popover open={isCoarse && open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          title={title}
          aria-label={title}
          className={cn(
            'w-7 h-7 rounded-md flex items-center justify-center transition-colors',
            disabled
              ? 'text-muted-foreground/40 cursor-not-allowed'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            className,
          )}
        >
          <Paperclip size={iconSize} />
        </button>
      </PopoverTrigger>
      {isCoarse && (
        <PopoverContent
          align="start"
          side="top"
          sideOffset={6}
          className="w-44 p-1"
        >
          <MenuItem
            icon={<Camera size={14} />}
            label="Take Photo"
            onClick={() => {
              setOpen(false);
              fileCameraRef.current?.click();
            }}
          />
          <MenuItem
            icon={<ImageIcon size={14} />}
            label="Photo Library"
            onClick={() => {
              setOpen(false);
              filePhotoRef.current?.click();
            }}
          />
          <MenuItem
            icon={<FileText size={14} />}
            label="Choose File"
            onClick={() => {
              setOpen(false);
              fileAnyRef.current?.click();
            }}
          />
        </PopoverContent>
      )}

      {/* Hidden inputs — one per accept/capture combination. Multiple
          inputs is cleaner than mutating attrs on a single one,
          because Safari is finicky about restarting a click() on a
          ref whose attrs changed mid-flight. */}
      <input
        ref={fileAnyRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = ''; // allow re-pick of the same file
        }}
      />
      <input
        ref={filePhotoRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileCameraRef}
        type="file"
        accept="image/*"
        // capture="environment" hints the rear camera on mobile.
        // Desktop browsers ignore it; we never reach this input on
        // desktop anyway because the menu is hidden.
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </Popover>
  );
}

function MenuItem({ icon, label, onClick }: {
  icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-foreground hover:bg-muted/60 transition-colors text-left"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/**
 * `(pointer: coarse)` covers touch screens (phones, tablets). Combine
 * with `(hover: none)` to exclude touch laptops where a precise mouse
 * is also present and the user expects desktop ergonomics.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(pointer: coarse) and (hover: none)');
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return coarse;
}
