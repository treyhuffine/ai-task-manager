'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiErrorText } from '@/lib/api/client';
import { HARNESS_IDS, HARNESS_REGISTRY } from '@/lib/harness/registry';
import { trpcClient } from '@/lib/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

const fields = [
  ...HARNESS_IDS.map((id) => {
    const harness = HARNESS_REGISTRY[id];
    return [harness.commandEnv, `${harness.name} executable`] as const;
  }),
  ['LOCAL_SPEECH_TO_TEXT_URL', 'Parakeet server URL'], ['GROQ_API_KEY', 'Groq API key'], ['OPENAI_API_KEY', 'Embeddings API key'],
] as const;
export function RuntimeSetup() {
  const query = useQuery({ queryKey: ['service-environment'], queryFn: () => trpcClient.service.environmentGet.query({}), retry: false });
  const [patch, setPatch] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!query.data) return null;
  const save = async () => {
    setSaving(true);
    try {
      await trpcClient.service.environmentPatch.mutate({body: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value || null]))});
      setPatch({}); await query.refetch();
      toast.success('Settings saved. Restart the service after current work finishes.');
    } catch (error) { toast.error(apiErrorText(error)); }
    finally { setSaving(false); }
  };
  return <details className="rounded-lg border p-4 text-sm">
    <summary className="cursor-pointer font-medium">Runtime setup</summary>
    <div className="mt-4 space-y-3">
      <p className="text-muted-foreground">Installed tools are discovered automatically. Set an absolute executable path if a tool is missing. Optional keys are encrypted in this installation.</p>
      {fields.map(([name, label]) => {
        const secret = name === 'GROQ_API_KEY' || name === 'OPENAI_API_KEY';
        const configured = secret && query.data?.secrets[name];
        return <label key={name} className="block space-y-1"><span>{label}{configured ? ' (configured)' : ''}</span>
          <Input type={secret ? 'password' : 'text'} autoComplete="off" value={patch[name] ?? (secret ? '' : String((!secret ? query.data?.values[name] : undefined) ?? ''))}
            placeholder={secret && configured ? 'Leave unchanged, or enter a replacement' : undefined}
            onChange={event => setPatch(previous => ({ ...previous, [name]: event.target.value }))} />
        </label>;
      })}
      <p className="text-muted-foreground">Install optional local speech in Voice settings, or configure an external Parakeet service here. The embeddings key enables semantic search. Keyword search works without it.</p>
      <Button disabled={saving || !Object.keys(patch).length} onClick={() => void save()}>Save runtime settings</Button>
    </div>
  </details>;
}
