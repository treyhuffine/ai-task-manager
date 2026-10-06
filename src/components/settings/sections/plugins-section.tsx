'use client';

/**
 * Settings → Plugins: what agents can be extended with, as two tabs.
 * Integrations (the default, and where "Connect apps" in the rail lands) let
 * agents act in your accounts. Skills teach them how to do things
 * (docs/skills.md). `openSettings('plugins', { anchor: 'skills' })` opens on
 * Skills, for links that are about a skill. New skill sits at the right of
 * the tabs, so starting one never needs the Skills tab first.
 */

import { INTEGRATION_LABELS } from '@/constants/integrations';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSettingsStore } from '@/components/settings/settings-store';
import { IntegrationsSection } from './integrations-section';
import { NewSkillButton, SkillsTab } from './plugins/skills-catalog';
import { InteractiveExamples } from './plugins/interactive-examples';

export type PluginsTab = 'integrations' | 'skills';

/** Tab labels in one place, so renaming a kind is one line. */
const TABS: ReadonlyArray<{ value: PluginsTab; label: string }> = [
  { value: 'integrations', label: INTEGRATION_LABELS.plural },
  { value: 'skills', label: 'Skills' },
];

/** `integrations:<providerId>` opens the Integrations tab on that provider (see IntegrationsSection). */
function tabFor(anchor: string | null): PluginsTab | null {
  if (anchor?.startsWith('integrations:')) return 'integrations';
  return anchor === 'skills' || anchor === 'integrations' ? anchor : null;
}

export function PluginsSection() {
  const { anchor } = useSettingsStore();
  const [tab, setTab] = useState<PluginsTab>(() => tabFor(anchor) ?? 'integrations');
  // A link that asks for a tab while Plugins is already showing switches to it.
  const [seen, setSeen] = useState(anchor);
  if (anchor !== seen) {
    setSeen(anchor);
    const asked = tabFor(anchor);
    if (asked) setTab(asked);
  }

  return (
    <>
      <InteractiveExamples />
      <Tabs value={tab} onValueChange={(value) => setTab(value as PluginsTab)} className="gap-5">
        {/* The button sits over the tab list's right end rather than in it: a tablist holds only tabs. */}
        <div className="relative">
          <TabsList variant="line" className="h-8 w-full justify-start gap-4 border-b border-border/60 px-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="h-full flex-none px-0.5 text-[12.5px]">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="absolute right-0 top-0 flex h-8 items-center pb-1">
            <NewSkillButton />
          </div>
        </div>
        <TabsContent value="integrations">
          <IntegrationsSection />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
