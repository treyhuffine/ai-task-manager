/**
 * The inline chip an issue or pull request becomes in the composer:
 * `[icon] #193`. Shared by the PR and issue chip nodes so the two can't
 * drift apart. The icons are in `state-icons.tsx`.
 */

import type { ReactNode } from 'react'
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tip } from '@/components/ui/tip'

/**
 * The chip itself. The tooltip carries the title (and a PR's branch) so the
 * person can confirm what they referenced without leaving the composer.
 */
export function GithubRefChip({
  node,
  editor,
  getPos,
  selected,
  icon,
  tooltip,
  noun,
}: Pick<NodeViewProps, 'node' | 'editor' | 'getPos' | 'selected'> & {
  icon: ReactNode
  tooltip: string
  /** `PR` or `issue`, for the remove button's label. */
  noun: string
}) {
  const number = node.attrs.number as number

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof getPos !== 'function') return
    const pos = getPos()
    if (pos == null) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
  }

  return (
    <Tip label={tooltip}>
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-drag-handle="false"
        className={cn(
          'inline-flex items-center align-baseline gap-1 px-1.5 py-0.5 mx-0.5',
          'rounded-md border bg-muted/40 text-foreground text-[12px] font-medium',
          'border-border hover:border-foreground/30 transition-colors',
          'cursor-default select-none',
          selected && 'ring-2 ring-primary/40 border-primary/40',
        )}
      >
        {icon}
        <span className="font-mono text-[11px]">#{number}</span>
        <button
          type="button"
          onMouseDown={handleRemove}
          className="ml-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label={`Remove ${noun} #${number}`}
          tabIndex={-1}
        >
          <X size={10} />
        </button>
      </NodeViewWrapper>
    </Tip>
  )
}
