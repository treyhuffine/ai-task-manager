'use client';

/**
 * Settings → Plugins: what agents can be extended with, as two tabs.
 * Connectors (the default, and where "Connect apps" in the rail lands) let
 * agents act in your accounts. Skills teach them how to do things
 * (docs/skills.md). `openSettings('plugins', { anchor: 'skills' })` opens on
 * Skills, for links that are about a skill.
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSettingsStore } from '@/components/settings/settings-store';
import { ConnectorsSection } from './connectors-section';
import { SkillsTab } from './plugins/skills-catalog';

export type PluginsTab = 'connectors' | 'skills';

/** Tab labels in one place, so renaming a kind is one line. */
const TABS: ReadonlyArray<{ value: PluginsTab; label: string }> = [
  { value: 'connectors', label: 'Connectors' },
  { value: 'skills', label: 'Skills' },
];

function tabFor(anchor: string | null): PluginsTab | null {
  return anchor === 'skills' || anchor === 'connectors' ? anchor : null;
}

export function PluginsSection() {
  const { anchor } = useSettingsStore();
  const [tab, setTab] = useState<PluginsTab>(() => tabFor(anchor) ?? 'connectors');
  // A link that asks for a tab while Plugins is already showing switches to it.
  const [seen, setSeen] = useState(anchor);
  if (anchor !== seen) {
    setSeen(anchor);
    const asked = tabFor(anchor);
    if (asked) setTab(asked);
  }

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as PluginsTab)} className="gap-5">
      <TabsList variant="line" className="h-8 w-full justify-start gap-4 border-b border-border/60 px-0">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="h-full flex-none px-0.5 text-[12.5px]">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="connectors">
        <ConnectorsSection />
      </TabsContent>
      <TabsContent value="skills">
        <SkillsTab />
      </TabsContent>
    </Tabs>
  );
}
