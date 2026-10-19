import { ClipboardList } from 'lucide-react';

const TEXT: Record<string, (app: string) => string> = {
  accepted: app => `You answered ${app}'s form`,
  declined: app => `You declined ${app}'s form`,
  cancelled: app => `${app}'s form closed without an answer`,
  expired: app => `${app}'s form waited too long and closed`,
  unsupported: app => `${app} asked for a form Ri cannot show`,
};

/** The recorded end of a server's form in its chat, so the transcript reads right after a reload or restart. */
export function ConnectedFormOutcome({raw}: {raw: unknown}) {
  const fields = (raw && typeof raw === 'object' ? raw : {}) as {outcome?: string; app?: string; reason?: string};
  const app = fields.app ?? 'The app';
  const text = (TEXT[fields.outcome ?? ''] ?? (name => `${name}'s form closed`))(app);
  return <div className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
    <ClipboardList size={12} className="shrink-0" />
    <span>{text}{fields.reason ? `. ${fields.reason}` : ''}</span>
  </div>;
}
