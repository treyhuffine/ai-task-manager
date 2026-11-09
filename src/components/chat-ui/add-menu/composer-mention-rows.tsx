'use client';

import type { RefObject } from 'react';
import { Bot, Cable, CheckSquare, StickyNote } from 'lucide-react';
import type { ChatInputEditorHandle } from '@/components/chat/editor/chat-input-editor';
import { mentionKind } from '@/components/chat/editor/mention-menu/ranking';
import type { MentionFilter } from '@/components/chat/editor/mention-menu/types';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { AddMenuRow } from './composer-add-menu';

/** The same context shortcuts before and after launch, using the editor's existing picker. */
export function ComposerMentionRows({ editor, agents = false, connectors = false }: {
  editor: RefObject<ChatInputEditorHandle | null>;
  agents?: boolean;
  connectors?: boolean;
}) {
  const open = (kind: MentionFilter) => () => editor.current?.openMentionMenu(mentionKind(kind).prefix);
  return <>
    <AddMenuRow icon={CheckSquare} onSelect={open('task')}>Tasks</AddMenuRow>
    <AddMenuRow icon={StickyNote} onSelect={open('note')}>Notes</AddMenuRow>
    {agents && <AddMenuRow icon={Bot} onSelect={open('agent')}>Agents</AddMenuRow>}
    {connectors && <AddMenuRow icon={Cable} onSelect={open('connector')}>{INTEGRATION_LABELS.plural}</AddMenuRow>}
  </>;
}
