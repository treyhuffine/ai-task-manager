/** @jsxRuntime automatic */
import { useState } from 'react';
import { AppShell, Notice, ShareScopeChooser, StatusLabel, useAnnounce, useMutation } from '@ri/app-kit/ui';
import type { ViewData } from './types.js';
import { errorText } from './format.js';

/** Ri opens this as the owner when they give a chat access. Nothing is selected by default. */
export function AccessScreen({ data }: { data: Extract<ViewData, { mode: 'access' }> }) {
  const announce = useAnnounce();
  const create = useMutation<Record<string, unknown>, { scopeRef: string; label: string }>('create_scope');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actor = data.actorId.startsWith('chat:') ? 'This chat' : data.actorId.startsWith('workspace:') ? 'This agent' : 'This caller';
  return (
    <AppShell eyebrow="Job Search" title="Choose what to share" context="Pick the collections and accounts a chat may use in Job Search. Ri saves the access when you confirm it there.">
      <div className="ri-stack">
        {created ? (
          <Notice tone="success" title="Access is ready to save in Ri" live>
            <StatusLabel tone="success">{created}</StatusLabel> Confirm it in Ri to finish. You can remove it later from Sources.
          </Notice>
        ) : (
          <ShareScopeChooser
            actorLabel={actor}
            sources={data.sources.map((source) => ({ id: source.key, label: source.label, description: source.description, textLabel: source.label }))}
            operations={[
              { id: 'read', label: 'Read records', description: 'See opportunities, interviews, preparation and the chosen accounts\' evidence' },
              { id: 'write', label: 'Change records', description: 'Save opportunities, move stages, save preparation and create follow-ups. Never sends anything' },
            ]}
            busy={create.pending}
            error={error}
            onCreate={async (sources, operations) => {
              setError(null);
              try {
                const result = await create.run({ actorId: data.actorId, sources, operations });
                setCreated(result.label);
                announce('Access prepared. Confirm it in Ri');
              } catch (failure) {
                setError(errorText(failure));
                throw failure;
              }
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
