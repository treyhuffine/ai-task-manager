'use client';

import { MessageSquare } from 'lucide-react';
import type { WorkspaceRecord } from '@/db/types';
import type { AgentTab } from '@/types/dashboard';
import { useAgentExecutions, useAgentPreviews } from '@/hooks/use-agent';
import { cn } from '@/lib/utils';
import {
  FloatingToolsBox,
  ToolsDivider,
  ToolsMini,
  ToolsRow,
  ToolsStripDivider,
} from '@/components/executions/workbench/tools-box';
import { useBesidePreview } from '@/components/chat-ui/artifacts/artifact-preview-provider';
import { PreviewIcon, previewName } from '@/components/chat-ui/artifacts/artifact-preview-parts';
import { AGENT_TOOL_TABS } from './agent-tools';
import { useBesideChatSummary } from './agent-beside-chat';

/**
 * The agent view's tools while its panel is closed: the execution view's
 * floating box (`FloatingToolsBox`), with this view's own tools. Without it
 * the only sign the tools exist is the panel toggle in the header.
 *
 * One row per tab, in the strip's order, then the file and the chat open
 * beside the main chat when there are any. A row opens the panel on it.
 * Status is text, as in the execution's box: who needs you in Overview,
 * how many previews are running.
 */
export function AgentToolsBox({
  workspace,
  onShow,
  file,
  chat,
}: {
  workspace: WorkspaceRecord;
  onShow: (tab: AgentTab) => void;
  /** The file beside the main chat, and how to bring it forward. */
  file?: { host: string; onShow: () => void } | null;
  /** The chat beside the main chat, and how to bring it forward. */
  chat?: { id: string; onShow: () => void } | null;
}) {
  const { needsYou, working } = useAgentExecutions(workspace.id);
  const { data } = useAgentPreviews(workspace.id);
  const running = (data?.previews ?? []).filter((p) => p.serverStatus === 'running').length;

  const status: Partial<Record<AgentTab, { text: string; tone: string; dot: string } | null>> = {
    overview: needsYou.length > 0
      ? { text: `${needsYou.length} ${needsYou.length === 1 ? 'needs' : 'need'} you`, tone: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' }
      : working.length > 0
        ? { text: `${working.length} working`, tone: '', dot: 'bg-emerald-500 animate-pulse' }
        : null,
    preview: running > 0 ? { text: `${running} running`, tone: '', dot: 'bg-emerald-500' } : null,
  };

  return (
    <FloatingToolsBox
      label={`${workspace.name} tools`}
      list={
        <div className="flex flex-col">
          {AGENT_TOOL_TABS.map(({ id, label, Icon }) => {
            const s = status[id];
            return (
              <ToolsRow
                key={id}
                icon={<Icon size={15} />}
                label={label}
                right={s && <span className={s.tone}>{s.text}</span>}
                onClick={() => onShow(id)}
              />
            );
          })}
          {(file || chat) && <ToolsDivider />}
          {file && <BesideFileRow host={file.host} onShow={file.onShow} />}
          {chat && <BesideChatRow chatId={chat.id} onShow={chat.onShow} />}
        </div>
      }
      strip={
        <>
          {AGENT_TOOL_TABS.map(({ id, label, Icon }) => {
            const s = status[id];
            return (
              <ToolsMini
                key={id}
                icon={<Icon size={16} />}
                label={s ? `${label} · ${s.text}` : label}
                badge={s?.dot}
                onClick={() => onShow(id)}
              />
            );
          })}
          {(file || chat) && <ToolsStripDivider />}
          {file && <BesideFileMini host={file.host} onShow={file.onShow} />}
          {chat && <BesideChatMini chatId={chat.id} onShow={chat.onShow} />}
        </>
      }
    />
  );
}

function BesideFileRow({ host, onShow }: { host: string; onShow: () => void }) {
  const open = useBesidePreview(host);
  if (!open) return null;
  return <ToolsRow icon={<PreviewIcon preview={open.preview} size={15} />} label={previewName(open.preview)} onClick={onShow} />;
}

function BesideFileMini({ host, onShow }: { host: string; onShow: () => void }) {
  const open = useBesidePreview(host);
  if (!open) return null;
  return <ToolsMini icon={<PreviewIcon preview={open.preview} size={16} />} label={previewName(open.preview)} onClick={onShow} />;
}

function BesideChatRow({ chatId, onShow }: { chatId: string; onShow: () => void }) {
  const { title, dot } = useBesideChatSummary(chatId);
  return (
    <ToolsRow
      icon={<MessageSquare size={15} />}
      label={title}
      right={dot && <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
      title="The chat open beside the main chat"
      onClick={onShow}
    />
  );
}

function BesideChatMini({ chatId, onShow }: { chatId: string; onShow: () => void }) {
  const { title, dot } = useBesideChatSummary(chatId);
  return <ToolsMini icon={<MessageSquare size={16} />} label={title} badge={dot ?? undefined} onClick={onShow} />;
}
