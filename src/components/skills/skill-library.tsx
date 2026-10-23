'use client';

import { useMemo, useState } from 'react';
import { useSkill } from '@/hooks/use-skills';
import { apiErrorText } from '@/lib/api/client';
import { NewSkillButton, SkillsTab } from '@/components/settings/sections/plugins/skills-catalog';
import { SkillEditor } from './skill-editor';
import { SkillHeader } from './skill-header';
import { SkillNavigationProvider } from './skill-navigation';

const keepCatalog = () => {};

/** The existing catalog, header and editor, without a required builder chat. */
export function SkillLibrary({ canManage }: { canManage: boolean }) {
  const [ref, setRef] = useState<string | null>(null);
  const selected = useSkill(ref);
  const navigation = useMemo(() => ({ openSkill: setRef, goHome: () => setRef(null), closeCatalog: keepCatalog, canManage, showSetupHelp: false }), [canManage]);
  return <SkillNavigationProvider value={navigation}>
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-muted-foreground">Installed skills are shared with every chat on this Home&apos;s approved workers. Owners manage the library. Drafts stay unused until installed.</p>
      {ref ? <div className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-lg border border-border">
        {selected.data ? <><SkillHeader skill={selected.data} onBack={() => setRef(null)} /><SkillEditor key={selected.data.ref} skill={selected.data} aiWriting={false} /></> :
          <p role={selected.error ? 'alert' : 'status'} className="p-4 text-xs">{selected.error ? apiErrorText(selected.error) : 'Loading skill…'} <button className="underline" onClick={() => setRef(null)}>Back to skills</button></p>}
      </div> : <>
        {canManage && <div className="flex justify-end"><NewSkillButton /></div>}
        <SkillsTab />
      </>}
    </div>
  </SkillNavigationProvider>;
}
