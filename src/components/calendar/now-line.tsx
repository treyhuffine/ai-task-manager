"use client";

/** The thin current-time marker, positioned as a fraction of its track. */
export function NowLine({ topPct }: { topPct: number }) {
  return (
    <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: `${topPct}%` }}>
      <div className="relative h-px bg-primary">
        <div className="absolute -left-0.5 -top-[0.1875rem] size-1.5 rounded-full bg-primary" />
      </div>
    </div>
  );
}
