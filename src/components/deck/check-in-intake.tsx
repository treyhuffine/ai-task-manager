"use client";

import { useState } from 'react';
import { ArrowRight, ArrowLeft, Zap, Calendar, Target, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContextChip } from '@/types/dashboard';

const DEFAULT_CHIPS: ContextChip[] = [
  { id: 'low-energy', label: 'Low energy today', selected: false },
  { id: 'packed-cal', label: 'Packed calendar', selected: false },
  { id: 'focus-area', label: 'Need to focus', selected: false },
];

const CHIP_ICONS: Record<string, React.ReactNode> = {
  'low-energy': <Zap size={9} className="inline mr-1 -mt-px" />,
  'packed-cal': <Calendar size={9} className="inline mr-1 -mt-px" />,
  'focus-area': <Target size={9} className="inline mr-1 -mt-px" />,
  'continue-previous': <History size={9} className="inline mr-1 -mt-px" />,
};

interface CheckInIntakeProps {
  onSubmit: (context: string, chips: string[]) => void;
  onSkip: () => void;
  hasPreviousDeck?: boolean;
  collapsed?: boolean;
  onExpand?: () => void;
}

export function CheckInIntake({ onSubmit, onSkip, hasPreviousDeck, collapsed, onExpand }: CheckInIntakeProps) {
  const [text, setText] = useState('');

  const allChips: ContextChip[] = [
    ...DEFAULT_CHIPS,
    ...(hasPreviousDeck
      ? [{ id: 'continue-previous', label: 'Incorporate previous deck', selected: false }]
      : []),
  ];

  const [chips, setChips] = useState<ContextChip[]>(allChips);

  if (collapsed) {
    return (
      <button
        onClick={onExpand}
        className="w-full px-4 py-2.5 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
      >
        <ArrowLeft size={10} /> Add context...
      </button>
    );
  }

  const toggleChip = (id: string) => {
    setChips(prev => prev.map(c => c.id === id ? { ...c, selected: !c.selected } : c));
  };

  const selectedChips = chips.filter(c => c.selected).map(c => c.label);

  const handleSubmit = () => {
    onSubmit(text.trim(), selectedChips);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="px-4 pt-5 pb-4 border-b border-border">
      <p className="text-[12px] text-muted-foreground mb-3">
        Anything I should know before I plan your day?
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Energy level, trigger changes, what's top of mind..."
        rows={2}
        className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-primary/30 transition-colors"
      />

      {/* Quick-tap chips */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {chips.map((chip) => (
          <button
            key={chip.id}
            onClick={() => toggleChip(chip.id)}
            className={cn(
              'px-2.5 py-1 rounded-md text-[10px] font-medium transition-all border',
              chip.selected
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground'
            )}
          >
            {CHIP_ICONS[chip.id]}
            {chip.label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-3">
        <button
          onClick={onSkip}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip, just show me the plan
        </button>
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-lg hover:opacity-90 active:scale-95 transition-all"
        >
          Continue <ArrowRight size={10} />
        </button>
      </div>
    </div>
  );
}
