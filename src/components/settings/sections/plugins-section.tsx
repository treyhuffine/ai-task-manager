'use client';

import { INTEGRATION_LABELS } from '@/constants/integrations';
import { useId, useState } from 'react';
import { PanelsTopLeft, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { openSettings, useSettingsStore } from '@/components/settings/settings-store';
import { IntegrationsSection } from './integrations-section';
import { NewSkillButton, SkillsTab } from './plugins/skills-catalog';
import { InteractiveExamples } from './plugins/interactive-examples';
import { McpServersSection } from './plugins/mcp-servers-section';
import { PLUGIN_CREATE_ANCHORS, pluginsTabFor, type PluginsTab } from './plugins/navigation';

/** Tab labels in one place, so renaming a kind is one line. */
const TABS: ReadonlyArray<{ value: PluginsTab; label: string }> = [
  { value: 'integrations', label: INTEGRATION_LABELS.plural },
  { value: 'skills', label: 'Skills' },
  { value: 'mcp', label: 'MCP servers' },
];

/** Creation stays available while the tabs organize what is already installed. */
export function PluginsSection() {
  const { anchor } = useSettingsStore();
  const tab = pluginsTabFor(anchor);
  const [visited, setVisited] = useState<PluginsTab[]>([tab]);
  // Mount each catalog on first use, then retain its search and unfinished form.
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  const [showExamples, setShowExamples] = useState(false);
  const examplesId = useId();

  return (
    <Tabs value={tab} onValueChange={value => openSettings('plugins', { anchor: value })} className="gap-5">
      {/* The sticky surface owns its top spacing and spans the pane's padding,
          so scrolled content cannot show above or beside it. */}
      <div className="sticky top-0 z-20 -mx-5 space-y-3 border-b border-border/60 bg-popover px-5 pb-1 pt-6" data-plugin-actions>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="xs" className="h-10 text-xs sm:h-8" onClick={() => openSettings('plugins', { anchor: PLUGIN_CREATE_ANCHORS.connectService })}>
            <Plus size={12} /> Connect a service
          </Button>
          <NewSkillButton className="h-10 text-xs sm:h-8" />
          <Button variant="outline" size="xs" className="h-10 text-xs sm:h-8" onClick={() => openSettings('plugins', { anchor: PLUGIN_CREATE_ANCHORS.mcpServer })}>
            <Plus size={12} /> Add MCP server
          </Button>
        </div>
        <TabsList variant="line" className="h-8 w-full justify-start gap-4 px-0">
          {TABS.map(t => <TabsTrigger key={t.value} value={t.value} className="h-full flex-none px-0.5 text-[12.5px]">{t.label}</TabsTrigger>)}
        </TabsList>
      </div>
      {visited.includes('integrations') && <TabsContent forceMount hidden={tab !== 'integrations'} value="integrations">
        <IntegrationsSection active={tab === 'integrations'} />
      </TabsContent>}
      {visited.includes('skills') && <TabsContent forceMount hidden={tab !== 'skills'} value="skills">
        <SkillsTab />
      </TabsContent>}
      {visited.includes('mcp') && <TabsContent forceMount hidden={tab !== 'mcp'} value="mcp">
        <McpServersSection active={tab === 'mcp'} />
      </TabsContent>}
      <div className="border-t border-border/60 pt-3">
        <Button variant="ghost" size="xs" className="text-[11px] text-muted-foreground" aria-expanded={showExamples} aria-controls={examplesId} onClick={() => setShowExamples(value => !value)}>
          <PanelsTopLeft size={12} /> Interactive examples
        </Button>
        {showExamples && <div id={examplesId} className="mt-3">
          <InteractiveExamples />
        </div>}
      </div>
    </Tabs>
  );
}
