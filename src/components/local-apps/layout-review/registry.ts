import type { ComponentType } from 'react';
import type { LayoutId } from './options';
import { DiscoverFirst } from './layouts/discover-first';
import { SplitLibrary } from './layouts/split-library';
import { AppsRail } from './layouts/apps-rail';
import { OneCollection } from './layouts/one-collection';
import { HomeDiscovery } from './layouts/home-discovery';
import { BesideChat } from './layouts/beside-chat';
import { PreviewBrowser } from './layouts/preview-browser';
import { GoalBundles } from './layouts/goal-bundles';
import { AppTabs } from './layouts/app-tabs';
import { ControlCenter } from './layouts/control-center';
import { AgentTools } from './layouts/agent-tools';
import { DiscoveryShelf } from './layouts/discovery-shelf';

/** Each candidate can be removed by deleting its file and these two catalog entries. */
export const REVIEW_LAYOUTS: Record<LayoutId, ComponentType> = {
  discover: DiscoverFirst, split: SplitLibrary, rail: AppsRail, collection: OneCollection,
  home: HomeDiscovery, chat: BesideChat, preview: PreviewBrowser, bundles: GoalBundles,
  tabs: AppTabs, control: ControlCenter, agent: AgentTools, shelf: DiscoveryShelf,
};
