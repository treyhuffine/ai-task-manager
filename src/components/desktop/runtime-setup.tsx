'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiErrorText } from '@/lib/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { EnvironmentSettings } from '@/lib/service/environment';

const fields = [
  ['CLAUDE_COMMAND', 'Claude executable'], ['CODEX_COMMAND', 'Codex executable'],
  ['CURSOR_COMMAND', 'Cursor executable'], ['OPENCODE_COMMAND', 'OpenCode executable'],
  ['ANTIGRAVITY_COMMAND', 'Antigravity executable'],
  ['LOCAL_SPEECH_TO_TEXT_URL', 'Parakeet server URL'], ['GROQ_API_KEY', 'Groq API key'], ['OPENAI_API_KEY', 'Embeddings API key'],
] as const;
export function RuntimeSetup() {
  const query = useQuery({ queryKey: ['service-environment'], queryFn: () => api.get<{ values: EnvironmentSettings; secrets: Record<string, boolean> }>('/service/environment'), retry: false });
  const [patch, setPatch] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!query.data) return null;
  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/service/environment', Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value || null])));
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
        const secret = name.endsWith('API_KEY');
        const configured = query.data?.secrets[name];
        return <label key={name} className="block space-y-1"><span>{label}{configured ? ' (configured)' : ''}</span>
          <Input type={secret ? 'password' : 'text'} autoComplete="off" value={patch[name] ?? (secret ? '' : String(query.data?.values[name as keyof EnvironmentSettings] ?? ''))}
            placeholder={secret && configured ? 'Leave unchanged, or enter a replacement' : undefined}
            onChange={event => setPatch(previous => ({ ...previous, [name]: event.target.value }))} />
        </label>;
      })}
      <p className="text-muted-foreground">Install optional local speech in Voice settings, or configure an external Parakeet service here. The embeddings key enables semantic search. Keyword search works without it.</p>
      <Button disabled={saving || !Object.keys(patch).length} onClick={() => void save()}>Save runtime settings</Button>
    </div>
  </details>;
}
