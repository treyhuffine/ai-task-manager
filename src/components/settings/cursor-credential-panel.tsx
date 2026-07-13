'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CredentialStatus {
  configured: boolean;
  source: 'flow_store' | 'environment' | 'none';
}

export function CursorCredentialPanel() {
  const [key, setKey] = useState('');
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['cursor-credential'],
    queryFn: () => api.get<CredentialStatus>('/agent/cursor/key'),
  });
  const save = useMutation({
    mutationFn: () => api.put<CredentialStatus>('/agent/cursor/key', { apiKey: key }),
    onSuccess: (data) => {
      setKey('');
      queryClient.setQueryData(['cursor-credential'], data);
      void queryClient.invalidateQueries({ queryKey: ['agent-connection', 'cursor'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-models', 'cursor'] });
      toast.success('Cursor API key saved');
    },
  });
  const clear = useMutation({
    mutationFn: () => api.delete<CredentialStatus>('/agent/cursor/key'),
    onSuccess: (data) => {
      queryClient.setQueryData(['cursor-credential'], data);
      void queryClient.invalidateQueries({ queryKey: ['agent-connection', 'cursor'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-models', 'cursor'] });
      toast.success('Stored Cursor API key removed');
    },
  });

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <KeyRound size={13} /> Cursor API key
      </div>
      <p className="text-[10.5px] text-muted-foreground">
        Stored locally in Flow&apos;s protected credential store. The key is only opened when Cursor starts.
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={status.data?.configured ? 'Replace configured key' : 'Paste API key'}
          className="h-8 rounded-md text-[11px]"
        />
        <Button size="sm" disabled={!key.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="animate-spin" />} Save
        </Button>
        {status.data?.source === 'flow_store' && (
          <Button size="icon-sm" variant="outline" disabled={clear.isPending} onClick={() => clear.mutate()} title="Remove stored key">
            <Trash2 />
          </Button>
        )}
      </div>
      {status.data?.configured && (
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
          Configured through {status.data.source === 'flow_store' ? 'Flow' : 'CURSOR_API_KEY'}
        </p>
      )}
    </div>
  );
}
