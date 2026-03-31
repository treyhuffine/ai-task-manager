"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  children: React.ReactNode;
}

export function EmojiPicker({ onSelect, children }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const handleSelect = useCallback(
    (emoji: { native: string }) => {
      onSelect(emoji.native);
      setOpen(false);
    },
    [onSelect]
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pickerWidth = 352; // emoji-mart default width
    let left = rect.left + rect.width / 2 - pickerWidth / 2;
    // Keep within viewport
    left = Math.max(16, Math.min(left, window.innerWidth - pickerWidth - 16));
    setPosition({
      top: rect.bottom + 8,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        pickerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={triggerRef}>
      <div onClick={() => setOpen((v) => !v)}>{children}</div>
      {open &&
        createPortal(
          <div
            ref={pickerRef}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              zIndex: 9999,
              pointerEvents: "auto",
            }}
          >
            <Picker
              data={data}
              onEmojiSelect={handleSelect}
              theme="dark"
              previewPosition="none"
              skinTonePosition="search"
              set="native"
            />
          </div>,
          document.body
        )}
    </div>
  );
}
