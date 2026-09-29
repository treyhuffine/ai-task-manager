'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api/client';
import type { ManagedSpeechStatus } from '@/lib/stt/managed/manager';

const labels: Record<ManagedSpeechStatus['phase'], string> = {
  'not-installed': 'Not installed', downloading: 'Downloading model', verifying: 'Verifying model', installed: 'Ready to start when needed',
  starting: 'Loading model', ready: 'Ready', transcribing: 'Transcribing', error: 'Needs attention',
};
export function ManagedSpeechSettings() {
  const client = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['managed-speech'], queryFn: () => api.get<ManagedSpeechStatus>('/service/speech'), refetchInterval: 2000, retry: false });
  const [pending, setPending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const providerState = data ? `${data.installed}:${data.enabled}:${data.helperAvailable}:${data.phase === 'error'}:${data.cloudFallback}` : '';
  useEffect(() => { if (providerState) window.dispatchEvent(new Event('ri:voice-providers-changed')); }, [providerState]);
  useEffect(() => { if (!data?.installed) setConfirmRemove(false); }, [data?.installed]);
  async function action(value: object) {
    setPending(true);
    try { client.setQueryData(['managed-speech'], await api.post<ManagedSpeechStatus>('/service/speech', value)); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : 'Local speech could not be changed'); }
    finally { setPending(false); }
  }
  if (error) return <p className="text-xs text-muted-foreground">Local speech installation is managed by the owner of this computer.</p>;
  if (!data) return <p className="text-xs text-muted-foreground">Checking local speech…</p>;
  const installing = data.phase === 'downloading' || data.phase === 'verifying';
  const busy = pending || data.phase === 'transcribing' || data.phase === 'starting';
  return <section className="space-y-3 rounded-lg border border-border p-3" aria-label="Managed local speech">
    <div><p className="text-sm font-medium">Optional local speech</p><p className="text-xs text-muted-foreground">Parakeet transcribes on the computer running Ri. Phone recordings travel to this computer. Audio stays out of cloud transcription unless you explicitly choose a cloud provider or enable fallback.</p></div>
    <p role="status" className="text-xs">{labels[data.phase]}{data.error ? `: ${data.error}` : ''}</p>
    {!data.helperAvailable && <p className="text-xs text-muted-foreground">This build does not include the local speech helper. You can configure an external Parakeet service in Runtime setup.</p>}
    {installing && <div className="space-y-1"><progress className="h-2 w-full" value={data.downloadedBytes} max={data.totalBytes} aria-label="Model download progress" /><p className="text-xs text-muted-foreground">{(data.downloadedBytes / 1024 ** 2).toFixed(0)} / {(data.totalBytes / 1024 ** 2).toFixed(0)} MiB</p></div>}
    {!data.installed && data.helperAvailable && <p className="text-xs text-muted-foreground">Downloads a verified {(data.totalBytes / 1024 ** 2).toFixed(0)} MiB model. Allow 900 MiB of free disk space. No Python or Docker installation is needed.</p>}
    <div className="flex flex-wrap gap-2">
      {data.installed && data.enabled && data.phase === 'error' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void action({ action: 'configure', enabled: true })}>Retry local speech</Button>}
      {!installing && data.helperAvailable && <Button size="sm" variant={data.installed ? 'outline' : 'default'} disabled={busy} onClick={() => void action({ action: 'install' })}>{data.installed ? 'Verify and repair' : data.phase === 'error' ? 'Resume or retry' : 'Install local speech'}</Button>}
      {installing && <Button size="sm" variant="outline" disabled={pending} onClick={() => void action({ action: 'cancel' })}>Pause download</Button>}
      {(data.installed || data.phase === 'error') && !installing && <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove model</Button>}
    </div>
    {confirmRemove && <div className="space-y-2 text-xs"><p>Remove the downloaded model and partial downloads? Your recordings, notes and tasks are kept.</p><Button size="sm" variant="destructive" disabled={busy} onClick={() => void action({ action: 'uninstall' })}>Remove downloaded model</Button> <Button size="sm" variant="outline" onClick={() => setConfirmRemove(false)}>Keep model</Button></div>}
    {data.installed && <label className="flex items-center justify-between gap-3 text-xs">Use managed local speech<Switch checked={data.enabled} disabled={busy || installing} onCheckedChange={enabled => void action({ action: 'configure', enabled })} /></label>}
    <label className="flex items-center justify-between gap-3 text-xs"><span>Allow automatic Groq fallback<span className="mt-1 block text-muted-foreground">When automatic provider selection cannot use local speech, send audio to Groq if a key is configured. An explicitly selected local model never switches providers.</span></span><Switch checked={data.cloudFallback} disabled={busy || installing} onCheckedChange={cloudFallback => void action({ action: 'configure', cloudFallback })} /></label>
    <p className="text-xs text-muted-foreground">The helper starts on demand and unloads after five idle minutes. Recordings are limited to 10 minutes and one local transcription at a time. <a className="underline" href="https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3" target="_blank" rel="noreferrer">NVIDIA Parakeet, CC BY 4.0</a></p>
  </section>;
}
