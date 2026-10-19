'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trpc, trpcClient } from '@/lib/trpc/client';
import type { ChatEventDTO } from '@/lib/api/dto/chat-event';
import { uploadAttachment } from '@/lib/attachments/client';
import { formContent, formErrors, initialValues, parseForm, type ResourceOption } from '@/lib/mcp-apps/form-schema';
import { cn } from '@/lib/utils';
import { FormFields, type FormFiles, type FormValues } from './form-fields';
import { FormPreview } from './form-preview';

/** This chat's attachments, from the transcript already loaded beside the form. Nothing is fetched for it. */
function useChatAttachments(chatId: string | null | undefined) {
  const queryClient = useQueryClient();
  const events = chatId ? queryClient.getQueryData<ChatEventDTO[]>(['session', chatId, 'events']) : undefined;
  return useMemo(() => {
    const seen = new Map<string, { fileName: string; name: string; mimeType?: string }>();
    for (const event of events ?? []) for (const file of event.attachments ?? []) {
      if (!seen.has(file.fileName)) seen.set(file.fileName, { fileName: file.fileName, name: file.originalName || file.fileName, mimeType: file.mimeType });
    }
    return [...seen.values()];
  }, [events]);
}

const CLOSED: Record<string, string> = {
  accepted: 'Sent.',
  declined: 'Declined.',
  cancelled: 'Closed without an answer.',
  expired: 'This form waited too long and closed.',
};

/**
 * A server's form, filled in place: in a chat card, or over the app view
 * whose call asked. The answer is checked here as the server will check it,
 * and again at the Home. `bare` drops the frame for a surface that has one.
 */
export function ConnectedForm({formId, bare = false}: {formId: string; bare?: boolean}) {
  const queryClient = useQueryClient();
  const options = trpc.connectedApps.forms.get.queryOptions({formId}, {retry: false});
  const query = useQuery(options);
  const form = query.data;
  const parsed = useMemo(() => form ? parseForm(form.schema) : null, [form]);
  const [values, setValues] = useState<FormValues | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResourceOption | null>(null);
  const attachments = useChatAttachments(form?.chatId);
  const current = values ?? (parsed?.ok ? initialValues(parsed.form) : {});

  const files: FormFiles = {
    local: !!form?.local,
    folders: form?.folders ?? [],
    attachments,
    add: (field, pick) => trpcClient.connectedApps.forms.file.mutate({formId, field, pick}),
    upload: async file => (await uploadAttachment(file)).fileName,
  };

  if (query.isPending) return <Frame bare={bare}><p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Loading form…</p></Frame>;
  if (!form) return <Frame bare={bare}><p className="text-xs text-muted-foreground">This form is no longer waiting for an answer.</p></Frame>;
  const closed = form.status !== 'open';

  const send = async (answer: {action: 'accept'} | {action: 'decline'}) => {
    if (!parsed?.ok) return;
    setFailure(null);
    let payload: Parameters<typeof trpcClient.connectedApps.forms.answer.mutate>[0]['answer'];
    if (answer.action === 'accept') {
      const content = formContent(parsed.form, current);
      const local = formErrors(parsed.form, content);
      setErrors(local);
      if (Object.keys(local).length) return;
      payload = {action: 'accept', content};
    } else payload = answer;
    setBusy(true);
    try {
      const result = await trpcClient.connectedApps.forms.answer.mutate({formId, answer: payload});
      setErrors(result.errors);
      await queryClient.invalidateQueries({queryKey: options.queryKey});
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Your answer could not be sent.');
      await queryClient.invalidateQueries({queryKey: options.queryKey});
    } finally { setBusy(false); }
  };

  return <Frame bare={bare}>
    <div className="flex items-start gap-2">
      <ClipboardList size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-medium">{form.app} is asking</p>
        {form.message && <p className="whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">{form.message}</p>}
      </div>
    </div>
    {!parsed?.ok
      ? <p role="alert" className="text-xs text-destructive">{parsed?.reason ?? 'This form cannot be shown.'}</p>
      : closed
        ? <p className="text-xs text-muted-foreground">{CLOSED[form.status] ?? 'Closed.'}</p>
        : <>
          {parsed.form.fields.length > 0 && <FormFields fields={parsed.form.fields} values={current} errors={errors} disabled={busy} files={files} labels={labels}
            onLabel={(uri, name) => setLabels(previous => ({...previous, [uri]: name}))}
            onChange={(name, value) => { setValues({...current, [name]: value}); setErrors(previous => { const next = {...previous}; delete next[name]; return next; }); }}
            onPreview={setPreview} />}
          {errors[''] && <p role="alert" className="text-xs text-destructive">{errors['']}</p>}
          {failure && <p role="alert" className="text-xs text-destructive">{failure}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => void send({action: 'accept'})}>{busy && <Loader2 size={12} className="animate-spin" />}{parsed.form.fields.length ? 'Submit' : 'OK'}</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => void send({action: 'decline'})}>Decline</Button>
          </div>
        </>}
    {preview && <FormPreview formId={formId} chatId={form.chatId} option={preview} onClose={() => setPreview(null)} />}
  </Frame>;
}

function Frame({bare, children}: {bare: boolean; children: React.ReactNode}) {
  return <section aria-label="Form" className={cn('space-y-3', !bare && 'my-2 rounded-xl border border-border bg-card/40 p-3')}>{children}</section>;
}
