import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { User } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import type { WizardState, WizardUpdate } from './types';

export function StepYou({
  state,
  update,
}: {
  state: WizardState;
  update: WizardUpdate;
}) {
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex shrink-0 size-10 items-center justify-center rounded-md bg-muted">
          <User className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Tell {APP_NAME} about you</h2>
          <p className="text-sm text-muted-foreground">
            Helps the AI keep context across tasks and chats.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          placeholder="Name"
          value={state.name}
          onChange={(e) => update({ name: e.target.value })}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">What are you working on right now?</Label>
        <Textarea
          id="description"
          placeholder="Shipping a side project, training for a marathon, learning Japanese…"
          value={state.description}
          onChange={(e) => update({ description: e.target.value })}
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          A starting point. Refine it anytime as your focus evolves.
        </p>
      </div>
    </div>
  );
}
