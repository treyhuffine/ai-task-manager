import type { Command } from 'commander';
import { runConversationAcp } from '@/lib/integrations/conversations/acp';

export function registerAcpCommand(program: Command) {
  program.command('acp').description('Connect a configured Ri agent to Buzz over ACP stdio')
    .option('--url <url>', 'Ri conversation bridge URL (or RI_CONVERSATION_URL)')
    .action(async (options: { url?: string }) => {
      const url = options.url ?? process.env.RI_CONVERSATION_URL;
      const token = process.env.RI_CONVERSATION_TOKEN;
      if (!url || !token) throw new Error('Create a Buzz connection in Ri Conversations, then set RI_CONVERSATION_URL and RI_CONVERSATION_TOKEN.');
      await runConversationAcp({ url, token });
    });
}
