import { isMcpTransport, mcpNotFound, riMcpHandler } from '@/lib/mcp/http-server';
import { emailActions } from '@/lib/orchestrator/email-actions';
import { runAction } from '@/lib/orchestrator/dispatch';
import { mcpCallContext } from '@/lib/orchestrator/mcp-caller';

function handle(request: Request) {
  if (!isMcpTransport(new URL(request.url).pathname.split('/').pop())) return Promise.resolve(mcpNotFound());
  const handler = riMcpHandler(server => {
    for (const action of emailActions) server.registerTool(action.name, { description: action.description, inputSchema: action.params }, async input => {
      const envelope = await runAction(action.name, input, mcpCallContext(request.headers));
      return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }], isError: !envelope.ok };
    });
  }, { name: 'ri-email', version: '0.1.0', instructions: 'When the user wants to draft or send an email, call create_email_draft to open an editable composer in this chat. Fill what is known, then revise with update_email_draft. The human can edit and send from the card.' });
  return handler(request);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
