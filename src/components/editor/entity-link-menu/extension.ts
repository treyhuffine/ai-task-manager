'use client';

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion';
import { createSuggestionPopupRenderer } from '@/components/chat/editor/suggestion/renderer';
import { searchApi } from '@/lib/api/search';
import { EntityLinkMenuList } from './popup';
import type { EntityLinkItem } from './types';

// Distinct key so this Suggestion doesn't collide with the slash menu that
// also lives in this editor (Tiptap rejects two plugins sharing the default
// `suggestion$` key).
const ENTITY_LINK_PLUGIN_KEY = new PluginKey('entityLinkSuggestion');

/**
 * `@` picker for the note/task editor — the same trigger the chat composer
 * uses, so linking works the same way everywhere. Searches tasks and notes by
 * title (server keyword search) and inserts an `entityLink` node that
 * serializes to `[[task:id]]` / `[[note:id]]`. Also reachable from the slash
 * menu ("Link"), which just types an `@`. `allowSpaces` is on because titles
 * contain spaces.
 */
export const EntityLinkMenuExtension = Extension.create({
  name: 'entityLinkMenu',
  priority: 200,

  addProseMirrorPlugins() {
    const suggestion: Partial<SuggestionOptions<EntityLinkItem, EntityLinkItem>> = {
      pluginKey: ENTITY_LINK_PLUGIN_KEY,
      char: '@',
      allowSpaces: true,
      startOfLine: false,
      items: async ({ query }: { query: string }) => {
        const q = query.trim();
        if (!q) return [];
        try {
          const results = await searchApi.query(q, { mode: 'keyword', limit: 8 });
          return results
            .filter((r) => r.entityType === 'task' || r.entityType === 'note')
            .map((r) => ({
              kind: r.entityType as EntityLinkItem['kind'],
              id: r.id,
              title: r.title ?? '',
              status: r.status,
            }));
        } catch {
          return [];
        }
      },
      command: ({
        editor,
        range,
        props: item,
      }: {
        editor: SuggestionProps<EntityLinkItem>['editor'];
        range: { from: number; to: number };
        props: EntityLinkItem;
      }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertEntityLink({ kind: item.kind, id: item.id })
          .insertContent(' ')
          .run();
      },
      render: createSuggestionPopupRenderer<EntityLinkItem>(EntityLinkMenuList),
    };

    return [Suggestion<EntityLinkItem, EntityLinkItem>({ editor: this.editor, ...suggestion })];
  },
});
