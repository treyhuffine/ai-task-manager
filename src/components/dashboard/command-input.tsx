"use client";

import { Mic, Send, Square } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { FormEvent, KeyboardEvent } from 'react';

interface CommandInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  isStreaming: boolean;
  onStop: () => void;
}

export function CommandInput({ input, setInput, onSubmit, isStreaming, onStop }: CommandInputProps) {
  const { theme, isFocusMode } = useDashboard();
  const isDark = theme === 'dark';

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onStop();
      } else if (input.trim()) {
        onSubmit(e);
      }
    }
  };

  return (
    <div className={cn(
      'flex-shrink-0 w-full pt-4 pb-8 transition-all duration-500',
      isFocusMode ? 'max-w-2xl mx-auto' : 'px-8'
    )}>
      <div className="max-w-3xl mx-auto space-y-4">
        <form onSubmit={onSubmit} className="relative group">
          {/* Glow effect on focus */}
          <div className="absolute -inset-1 bg-primary/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity" />

          <div className={cn(
            'relative bg-card border border-border rounded-2xl p-1.5 flex items-center gap-3',
            'shadow-[0_20px_50px_rgba(0,0,0,0.1)] focus-within:border-primary/30 transition-all'
          )}>
            {/* Microphone button */}
            <button
              type="button"
              className="relative w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/30 hover:opacity-90 hover:scale-105 active:scale-95 transition-all group/mic overflow-hidden"
            >
              <Mic size={22} className="relative z-10" />
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/mic:translate-y-0 transition-transform duration-300" />
              <div className="absolute inset-0 rounded-xl border border-white/20 animate-pulse" />
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell Flow what's next..."
              className="flex-1 bg-transparent border-none outline-none text-base py-3 placeholder:text-muted-foreground"
            />

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="w-12 h-12 rounded-xl flex items-center justify-center bg-destructive text-destructive-foreground shadow-xl transition-all active:scale-95"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className={cn(
                  'w-12 h-12 rounded-xl flex items-center justify-center transition-all',
                  input.trim()
                    ? 'bg-primary text-primary-foreground shadow-xl active:scale-95'
                    : isDark ? 'bg-secondary text-muted-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                <Send size={20} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
