import { z } from 'zod';
import * as q from '@/lib/db/queries';
import { defineAction, ActionError, type ActionContext } from '@/lib/orchestrator/types';
import { personalChat } from './service';

function authorizedChat(ctx: ActionContext, id: string) {
  const caller = ctx.actor?.sessionId ? personalChat(ctx.actor.sessionId) : null;
  return personalChat(id, caller?.userId);
}

export const historyActions = [
  defineAction({
    name: 'get_session_events',
    description: 'Read a bounded page of complete personal chat messages and tool events, including orchestrator and agent main chats. No provider raw records. before is an event ID from this chat. Large text continues with get_chat_event. Use next_before for older pages.',
    params: { session_id: z.string().min(1), before: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
    handler: (ctx, input) => {
      authorizedChat(ctx, input.session_id);
      if (input.before && q.getAgentHistoryCursor(input.before)?.sessionId !== input.session_id) throw new ActionError('invalid_params', 'The history cursor must belong to this chat.');
      const rows = q.listAgentHistoryPage(input.session_id, { before: input.before, limit: (input.limit ?? 20) + 1 });
      const hasOlder = rows.length > (input.limit ?? 20);
      const page = hasOlder ? rows.slice(1) : rows;
      let remaining = 100_000;
      return { events: page.map(row => {
        const length = Math.min(20_000, remaining);
        remaining -= Math.min(row.content?.length ?? 0, length);
        const toolInput = row.toolInput == null ? null : JSON.stringify(row.toolInput);
        return { ...row, content: row.content?.slice(0, length) ?? null, contentLength: row.content?.length ?? 0,
          next_content_offset: (row.content?.length ?? 0) > length ? length : null,
          toolInput: toolInput?.slice(0, 4000) ?? null, toolInputLength: toolInput?.length ?? 0,
          next_tool_input_offset: (toolInput?.length ?? 0) > 4000 ? 4000 : null };
      }),
        hasOlder, next_before: hasOlder ? page[0]?.id ?? null : null };
    },
  }),
  defineAction({
    name: 'get_chat_event', description: 'Read an exact personal chat event with full text in bounded slices. Pass next_offset to continue a long message. No provider raw records. Use this to inspect details omitted from the condensed oversight transcript.',
    params: { id: z.string().min(1), offset: z.number().int().min(0).optional(), tool_input_offset: z.number().int().min(0).optional(), max_chars: z.number().int().min(1).max(100_000).optional() },
    handler: (ctx, input) => {
      const event = q.getAgentHistoryEvent(input.id);
      if (!event) throw new ActionError('not_found', 'Message not found.');
      authorizedChat(ctx, event.sessionId);
      const offset = input.offset ?? 0;
      const end = offset + (input.max_chars ?? 20_000);
      const toolInput = event.toolInput == null ? null : JSON.stringify(event.toolInput);
      const toolOffset = input.tool_input_offset ?? 0;
      const toolEnd = toolOffset + (input.max_chars ?? 20_000);
      return { ...event, content: event.content?.slice(offset, end) ?? null, contentLength: event.content?.length ?? 0,
        next_offset: (event.content?.length ?? 0) > end ? end : null,
        toolInput: toolInput?.slice(toolOffset, toolEnd) ?? null, toolInputLength: toolInput?.length ?? 0,
        next_tool_input_offset: (toolInput?.length ?? 0) > toolEnd ? toolEnd : null };
    },
  }),
];
