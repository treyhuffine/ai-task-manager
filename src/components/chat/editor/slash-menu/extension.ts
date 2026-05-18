'use client'

import { Extension } from '@tiptap/core'
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { createSuggestionRenderer } from './renderer'
import type { SkillCommandDescriptor } from './types'

interface SlashMenuOptions {
  /**
   * Getter for the current command list. Wrapped in a closure so the
   * extension always sees the latest TanStack Query data even though its
   * options are frozen at editor-create time.
   */
  getCommands?: () => SkillCommandDescriptor[]
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
export const SlashMenuExtension = Extension.create<SlashMenuOptions>({
  name: 'slashMenu',

  // Run before the chat composer's Enter→submit keymap so Enter on an
  // open suggestion selects the skill instead of submitting a half-typed
  // "/query" as a regular message. Default Tiptap priority is 100.
  priority: 200,

  addOptions() {
    return { getCommands: undefined }
  },

  addProseMirrorPlugins() {
    const getCommands = () => this.options.getCommands?.() ?? []

    const suggestion: Partial<SuggestionOptions<SkillCommandDescriptor, SkillCommandDescriptor>> = {
      char: '/',
      allowSpaces: false,
      startOfLine: true,
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase()
        return getCommands().filter((cmd) => {
          if (cmd.name.toLowerCase().includes(q)) return true
          if (cmd.description?.toLowerCase().includes(q)) return true
          return false
        })
      },
      command: ({
        editor,
        range,
        props: cmd,
      }: {
        editor: SuggestionProps<SkillCommandDescriptor>['editor']
        range: { from: number; to: number }
        props: SkillCommandDescriptor
      }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(`/${cmd.name} `)
          .run()
      },
      render: createSuggestionRenderer(),
    }

    return [
      Suggestion<SkillCommandDescriptor, SkillCommandDescriptor>({
        editor: this.editor,
        ...suggestion,
      }),
    ]
  },
})
