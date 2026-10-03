'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { ThinkingDots } from '@/components/executions/thinking-dots';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import { useOrchestratorIdentity } from '@/hooks/use-user-state';
import { cn } from '@/lib/utils';
import type { OnboardingStep } from './onboarding-flow';

/**
 * The pieces the first-run conversation is drawn with: the transcript's own
 * message components, so it reads as the chat it is, plus the card a step
 * asks with and its buttons.
 */

/** One run of the assistant's messages, under its avatar and name. */
export function Turn({ children }: { children: ReactNode }) {
  const { name } = useOrchestratorIdentity();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <OrchestratorAvatar size="sm" />
        <span className="text-[11px] font-semibold text-foreground/80">{name}</span>
      </div>
      {children}
    </div>
  );
}

export function Says({ children }: { children: ReactNode }) {
  return (
    <Message from="assistant">
      <MessageContent className="text-[12.5px] leading-relaxed">{children}</MessageContent>
    </Message>
  );
}

/** The user's answer, as their message. The name step shows the face it picked. */
export function Reply({ step, children }: { step: OnboardingStep; children: ReactNode }) {
  return (
    <Message from="user">
      <MessageContent className="whitespace-pre-wrap break-words text-[12.5px]">
        {step === 'identity' ? (
          <span className="inline-flex items-center gap-1.5">
            <OrchestratorAvatar size="xs" />
            {children}
          </span>
        ) : (
          children
        )}
      </MessageContent>
    </Message>
  );
}

export function Typing() {
  return (
    <div className="flex flex-col gap-1.5">
      <OrchestratorAvatar size="sm" />
      <div className="pl-0.5 text-muted-foreground">
        <ThinkingDots />
      </div>
    </div>
  );
}

/** The card a step asks its question with. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card/60 p-3 shadow-sm', className)}>{children}</div>
  );
}

export function PrimaryButton({
  children,
  disabled,
  busy,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {busy && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  );
}

export function QuietButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {children}
    </button>
  );
}

