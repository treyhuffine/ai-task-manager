"use client";

import { AlertCircle } from 'lucide-react';

interface PlanBriefingProps {
  summary: string;
  worthNoting?: string;
}

export function PlanBriefing({ summary, worthNoting }: PlanBriefingProps) {
  return (
    <div className="px-4 pt-4 pb-3">
      <p className="text-[12px] text-foreground/90 leading-relaxed">
        {summary}
      </p>

      {worthNoting && (
        <div className="mt-2.5 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
          <AlertCircle size={12} className="text-amber-500/70 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-500/80 leading-relaxed">
            {worthNoting}
          </p>
        </div>
      )}
    </div>
  );
}
