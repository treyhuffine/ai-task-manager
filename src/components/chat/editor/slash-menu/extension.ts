'use client'

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { splitLeadingSlashCommand } from '@/lib/agent-skills/parse-invocation'
import { createSuggestionRenderer } from './renderer'
import { rankCommands, type CommandMatch } from './ranking'
import { SLASH_CHIP_NAME } from './slash-chip-node'
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
  /** True while the session/launch slash-command list is still fetching. */
  isLoading?: () => boolean
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
    return { getCommands: undefined, isLoading: undefined }
  },

  addStorage() {
    return { refresh: () => {}, open: () => {} }
  },

  addProseMirrorPlugins() {
    const getCommands = () => this.options.getCommands?.() ?? []
    const isLoading = () => this.options.isLoading?.() ?? false

    const suggestion: Partial<SuggestionOptions<CommandMatch, CommandMatch>> = {
      pluginKey: SLASH_MENU_PLUGIN_KEY,
      char: '/',
      allowSpaces: false,
      startOfLine: true,
      allow: ({ editor, range }) => {
        // Require the slash to lead the entire message (leading whitespace
        // aside) so mid-sentence paths or line-2 paths never become commands.
        const before = editor.state.doc.textBetween(0, range.from, '\n', '\uFFFC')
        return before.trim() === ''
      },
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
        const after = editor.state.doc.textBetween(
          range.to,
          Math.min(range.to + 1, editor.state.doc.content.size),
          '\n',
          '\uFFFC',
        )
        const chain = editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertSlashChip({
            name: match.command.name,
            ...(match.command.description ? { description: match.command.description } : {}),
          })
        // Keep the existing separator, with the caret after it, so typing
        // arguments cannot become part of the command's name.
        if (/^\s/.test(after)) chain.setTextSelection(range.from + 2)
        else chain.insertContent(' ')
        chain.run()
      },
      render: () => {
        const renderer = createSuggestionRenderer()()
        let current: SuggestionProps<CommandMatch> | null = null
        const withCommands = (props: SuggestionProps<CommandMatch>) => ({
          ...props,
          items: rankCommands(getCommands(), props.query),
          loading: isLoading(),
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

    // Upgrade a manually typed leading `/known-command` to a badge when the
    // user presses space after it, matching menu selection.
    const promoteTypedSlash = new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing || text !== ' ' || from !== to) return false
          const chipType = view.state.schema.nodes[SLASH_CHIP_NAME]
          if (!chipType) return false
          const before = view.state.doc.textBetween(0, from, '\n', '\uFFFC')
          const parsed = splitLeadingSlashCommand(before)
          if (!parsed || parsed.rest !== '') return false
          const match = getCommands().find((c) => c.name.toLowerCase() === parsed.name.toLowerCase())
          if (!match) return false
          const tokenFrom = from - parsed.token.length
          const chip = chipType.create({
            name: match.name,
            ...(match.description ? { description: match.description } : {}),
          })
          const tr = view.state.tr.replaceWith(tokenFrom, from, [chip, view.state.schema.text(' ')])
          view.dispatch(tr)
          return true
        },
      },
    })

    return [
      promoteTypedSlash,
      Suggestion<CommandMatch, CommandMatch>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
