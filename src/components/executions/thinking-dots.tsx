/**
 * Three-dot bounce animation. The chat-native equivalent of a spinner —
 * reads as "thinking" rather than "loading data." Used by ThinkingState
 * (post-user-message wait) and SetupCard (worktree provisioning).
 *
 * Tailwind's animate-bounce gives a 1s vertical translate; staggering
 * the per-dot delays creates a wave. Inline styles for delays because
 * Tailwind doesn't ship arbitrary `animation-delay` utilities by default.
 */
export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1 h-1 rounded-full bg-current opacity-80 animate-bounce"
          style={{ animationDelay: `${delay}ms`, animationDuration: '0.9s' }}
        />
      ))}
    </span>
  );
}
