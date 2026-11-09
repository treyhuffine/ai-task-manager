'use client'

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionRenderer } from './renderer'
import { rankCommands, type CommandMatch } from './ranking'
import type { SlashCommand } from './types'

// Each Suggestion plugin needs its own PluginKey — without one they
// all default to `suggestion$` and ProseMirror throws "Adding different
// instances of a keyed plugin" when multiple suggestion menus live in
// the same editor.
const SLASH_MENU_PLUGIN_KEY = new PluginKey('slashMenuSuggestion')

interface SlashMenuOptions {
  /**
   * Getter for the current command list. Wrapped in a closure so the
   * extension always sees the latest TanStack Query data even though its
   * options are frozen at editor-create time.
   */
  getCommands?: () => SlashCommand[]
}

interface SlashMenuStorage {
  refresh: () => void
  open: () => void
}

declare module '@tiptap/core' {
  interface Storage {
    slashMenu: SlashMenuStorage
  }
}

/**
 * Tiptap extension that opens a slash-command popover when the user
 * types `/` at the start of the composer. Items come from agentex's
 * `discoverSkillCommands` + `reconcileSkillCommands` pipeline (via
 * `useSlashCommands` on the React side).
 *
 * Trigger semantics match Claude Code's `parseSlashCommand`: the popup
 * opens only when `/` is the first character of a text block. Mid-input
 * slashes are treated as plain text — they won't open the popup, and
 * the agent runtime won't resolve them as commands either.
 *
 * Selection inserts `/<name> ` and leaves the caret at the end. If the
 * skill takes no arguments, the user can hit Enter to submit; if it
 * does, they keep typing. Either way the submit path is the existing
 * `session.send(text)` — Claude Code handles the expansion server-side.
 */
export const SlashMenuExtension = Extension.create<SlashMenuOptions, SlashMenuStorage>({
  name: 'slashMenu',

  // Run before the chat composer's Enter→submit keymap so Enter on an
  // open suggestion selects the skill instead of submitting a half-typed
  // "/query" as a regular message. Default Tiptap priority is 100.
  priority: 200,

  addOptions() {
    return { getCommands: undefined }
  },

  addStorage() {
    return { refresh: () => {}, open: () => {} }
  },

  addProseMirrorPlugins() {
    const getCommands = () => this.options.getCommands?.() ?? []

    const suggestion: Partial<SuggestionOptions<CommandMatch, CommandMatch>> = {
      pluginKey: SLASH_MENU_PLUGIN_KEY,
      char: '/',
      allowSpaces: false,
      startOfLine: true,
      // All ordering lives in `ranking.ts` — see the tier table there for why
      // a name match can never lose to a description match.
      items: ({ query }: { query: string }) => rankCommands(getCommands(), query),
      command: ({
        editor,
        range,
        props: match,
      }: {
        editor: SuggestionProps<CommandMatch>['editor']
        range: { from: number; to: number }
        props: CommandMatch
      }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(`/${match.command.name} `)
          .run()
      },
      render: () => {
        const renderer = createSuggestionRenderer()()
        let current: SuggestionProps<CommandMatch> | null = null
        const withCommands = (props: SuggestionProps<CommandMatch>) => ({
          ...props,
          items: rankCommands(getCommands(), props.query),
        })
        // Query data can arrive or change while the caret and query stay put.
        // Tiptap only reruns items when the suggestion itself changes.
        this.storage.refresh = () => {
          if (current) renderer.onUpdate?.(withCommands(current))
        }
        // The + menu explicitly reopens a token previously dismissed with Escape.
        this.storage.open = () => {
          if (current) renderer.onStart?.(withCommands(current))
        }
        return {
          ...renderer,
          onStart: (props) => {
            current = props
            renderer.onStart?.(withCommands(props))
          },
          onUpdate: (props) => {
            current = props
            renderer.onUpdate?.(withCommands(props))
          },
          onExit: () => {
            current = null
            renderer.onExit?.()
          },
        }
      },
    }

    return [
      Suggestion<CommandMatch, CommandMatch>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
