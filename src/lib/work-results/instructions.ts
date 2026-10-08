import { getWorkResultCapabilities } from './capabilities';
import { resolveServerPort } from '@/lib/orchestrator/harness-surface';
import { readAuthConfig } from '@/lib/auth/config-file';
import { SESSION_CREDENTIAL_HEADER, sessionCredential } from '@/lib/orchestrator/session-credential';
import type { McpServerConfig } from '@agentex/agent';

/** A login shell keeps the server's pinned launcher, connected devices use their own CLI. */
export function handoffCliCommand(): string { return '"${RI_SESSION_CLI:-ri}"'; }

/** Deliberate reporting, never automatic turn classification or extra work. */
export function workResultSessionInstructions(cliCommand = handoffCliCommand()): string {
  if (!getWorkResultCapabilities().handoffsEnabled) return '';
  return [
    '# Durable handoffs',
    'When you finish a meaningful deliverable, call get_handoff_context before preparing or reporting the handoff to load current guidance. Fetch fresh context for each new handoff or meaningful update, unless the current assignment already supplies its handoff context. Use ordinary chat for progress, questions, discussion and small confirmations. Saving a handoff does not accept work, complete a task or authorize delivery.',
    `Use the get_handoff_context MCP tool when attached, or run ${cliCommand} agent get_handoff_context.`,
  ].join('\n\n');
}

/** Full workflow detail is loaded only at the handoff boundary. */
export function builtInHandoffInstructions(cliCommand = handoffCliCommand()): string {
  const capabilities = getWorkResultCapabilities();
  if (!capabilities.handoffsEnabled) return '';
  return [
    '# Preparing and reporting a durable handoff',
    'Use report_result when you produce or materially update something the user will use, inspect, or share: working changes, a finished artifact, or findings from an assigned investigation. Include useful outputs and important limitations. Use ordinary chat for questions, progress, discussion, and small confirmations. Do not create extra artifacts or repeat checks merely to populate a report.',
    `Invoke ${cliCommand} agent report_result --input '<JSON object>', or --input @<json-file>. For example, the JSON object has {"request_id":"stable-key","body":"Useful findings or finished work."}. Inline JSON avoids creating a file solely to report. Supply request_id (a stable retry key), body (Markdown), and optional title, attachments (uploaded attachment records), links, attention, task_ids, or supersedes_id. Retry unchanged intent with the same request_id. Never submit a temporary file path as an attachment. Use the results MCP when attached, with the same action names.`,
    'get_result and list_results retrieve saved snapshots. Saving does not accept work, complete a task, or authorize delivery. Preserve useful native review evidence in independent_review with honest reported provenance.',
    'Use labeled HTTP(S) links, such as {"kind":"url","label":"Demo","url":"https://example.com/demo"}. A preview link references an existing preview_target_id. Never invent a preview identity or use a local file path as a link. Keep returned uploaded attachment records intact when including them in attachments.',
    'For useful visual evidence, browser_read with mode screenshot returns a durable uploaded attachment while handoffs are enabled. Include that returned attachment record in report_result. Browser PDF exports and downloads also return uploaded records. Live previews and URLs may change, so distinguish a captured screenshot from the live view.',
    `Upload an existing local screenshot or artifact with ${cliCommand} attachment upload <path>. Include its returned attachment record in report_result. This uploads selected bytes through Ri's existing attachment API. Do not put local paths in result links or attachments. The agent browser cannot browse loopback services. Use your existing authorized local browser/check facilities for a local preview and upload useful captures, or state the limitation.`,
    capabilities.aiReviewEnabled
      ? `Only when the human explicitly requests independent scrutiny, use request_result_review (request_id, result_id, optional focus/harness/model/variant/effort). report_result_review records assigned or already completed review evidence. The CLI invocation is ${cliCommand} agent <action> --input '<JSON object>' or --input @<json-file>. Reviewers inspect the original request and actual work, report concrete findings and limits, and may find no actionable issues. AI review never accepts, completes, merges, publishes, or automatically repairs work.`
      : '',
  ].filter(Boolean).join('\n\n');
}

/** Current guidance rides the harness message too, including cached/resumed sessions. */
export function withWorkResultSessionInstructions(message: string, surfaceKind: string | null): string {
  if (surfaceKind === 'result_review') return message;
  const guidance = workResultSessionInstructions();
  return guidance ? `[Current Ri session capabilities, supplied by the app.]\n${guidance}\n[User message follows.]\n${message}` : message;
}

export function workResultsMcpServer(sessionId: string, port = resolveServerPort()): McpServerConfig | null {
  const token = readAuthConfig()?.localToken;
  if (!token) return null;
  const credential = sessionCredential(sessionId, token);
  return {
    name: 'results',
    type: 'http',
    url: `http://localhost:${port}/api/orchestrator/results/mcp`,
    headers: { Authorization: `Bearer ${token}`, ...(credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {}) },
  };
}
