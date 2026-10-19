import type { McpServerConfig } from '@agentex/agent';
import { readAuthConfig } from '@/lib/auth/config-file';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { resolveServerPort } from '@/lib/orchestrator/harness-surface';

export const EMAIL_COMPOSER_INSTRUCTIONS = 'When the user wants to draft or send email, use create_email_draft to open an editable composer in this chat. Fill known to, cc, bcc, subject and plain-text body fields. The user can edit the draft, choose a sending account and click Send. To revise it, read get_email_draft and use update_email_draft with expected_revision, preserving human edits. Draft tools never send. Use the attached email tools or "${RI_SESSION_CLI:-ri}" agent <action> --input \'<JSON>\'.';

export function emailMcpServer(sessionId: string): McpServerConfig | null {
  const token = readAuthConfig()?.localToken;
  if (!token) return null;
  const credential = sessionCredential(sessionId, token);
  return { name: 'email', type: 'http', url: `http://localhost:${resolveServerPort()}/api/orchestrator/email/mcp`, headers: { Authorization: `Bearer ${token}`, ...(credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {}) } };
}
