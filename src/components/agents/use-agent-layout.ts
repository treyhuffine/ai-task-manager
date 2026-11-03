'use client';

import { useCallback, useEffect, useState } from 'react';
import { useHomeStorageScope } from '@/components/home/home-context';
import { homeStorageIdentity } from '@/lib/home/document-scope';
import { readJson, usePersistedPct, useTerminalHeight, writeJson } from '@/components/executions/workbench/use-workbench';
import {
  agentLayoutReducer,
  fromLegacyLayout,
  fromPersisted,
  toPersisted,
  type AgentLayoutAction,
  type AgentLayoutState,
} from './agent-layout';

const STATE_KEY = (id: string) => `ri.agent.workbench.${id}`;
const TOOLS_WIDTH_KEY = 'ri.agent.workbench.toolsPct';
/** Where react-resizable-panels kept the one layout every agent shared. Read, never written. */
const LEGACY_LAYOUT_KEY = 'react-resizable-panels:ri.agent.layout';

export const DEFAULT_TOOLS_PCT = 58;

export interface AgentLayout {
  state: AgentLayoutState;
  dispatch: (action: AgentLayoutAction) => void;
  /** The tools panel's width, in % of the view. One preference for every agent. */
  toolsPct: number;
  setToolsPct: (pct: number) => void;
  /** The terminal drawer's height, shared with the execution view's drawer. */
  terminalPct: number;
  setTerminalPct: (pct: number) => void;
}

function load(storageId: string, legacyToolsOpen: boolean | undefined): AgentLayoutState {
  return fromPersisted(readJson(STATE_KEY(storageId)), legacyToolsOpen ?? true);
}

/**
 * Layout state for one agent's view (`agent-layout.ts`), persisted per
 * agent the way an execution's workbench is per execution (`use-workbench.ts`).
 *
 * Moving to another agent loads its state during render, before anything
 * commits, so the previous agent's open terminal never mounts a drawer (and
 * starts a shell) in the next agent's folder.
 */
export function useAgentLayout(workspaceId: string): AgentLayout {
  const storageId = homeStorageIdentity(workspaceId, useHomeStorageScope());
  const [legacy] = useState(() => fromLegacyLayout(readJson(LEGACY_LAYOUT_KEY)));
  const [layout, setLayout] = useState(() => {
    const state = load(storageId, legacy.toolsOpen);
    return { id: storageId, state, loaded: state };
  });
  if (layout.id !== storageId) {
    const state = load(storageId, legacy.toolsOpen);
    setLayout({ id: storageId, state, loaded: state });
  }

  // Only a change made here is written, so looking at an agent never
  // stores the defaults as if they were chosen.
  useEffect(() => {
    if (layout.state === layout.loaded) return;
    writeJson(STATE_KEY(layout.id), toPersisted(layout.state));
  }, [layout]);

  const dispatch = useCallback((action: AgentLayoutAction) => {
    setLayout((current) => {
      const state = agentLayoutReducer(current.state, action);
      return state === current.state ? current : { ...current, state };
    });
  }, []);

  const [toolsPct, setToolsPct] = usePersistedPct(TOOLS_WIDTH_KEY, legacy.toolsPct ?? DEFAULT_TOOLS_PCT, 25, 80);
  const [terminalPct, setTerminalPct] = useTerminalHeight();

  return { state: layout.state, dispatch, toolsPct, setToolsPct, terminalPct, setTerminalPct };
}
