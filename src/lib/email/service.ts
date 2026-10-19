import { getEmailDraft, transitionEmailDraft } from '@/lib/db/queries';
import { getIntegrationOwnerId, getIntegrationRuntime } from '@/lib/integrations/runtime';
import { EMAIL_COMPOSER_CALLER } from './caller';
import { emailRecipients, emailSendProblem, EmailDraftError } from './validation';
import type { EmailDraft } from '@/db/types';
import { INTEGRATION_LABELS } from '@/constants/integrations';

export async function emailAccounts() {
  const runtime = await getIntegrationRuntime();
  const connections = await runtime.listConnections({ ownerId: getIntegrationOwnerId() });
  return connections.filter(connection => connection.status === 'active' && (connection.providerId === 'google' || connection.providerId === 'microsoft'))
    .map(connection => ({ id: connection.id, provider: connection.providerId, label: connection.email ?? connection.label ?? (connection.providerId === 'google' ? 'Gmail' : 'Outlook') }));
}

export function emailSendRequest(draft: EmailDraft, provider: string) {
  if (provider === 'google') return {
    actionId: 'gmail.send_email',
    input: { to: emailRecipients(draft.to).join(', '), cc: emailRecipients(draft.cc).join(', ') || undefined, bcc: emailRecipients(draft.bcc).join(', ') || undefined, subject: draft.subject, body: draft.body },
  };
  if (provider === 'microsoft') return {
    actionId: 'outlook_mail.send_mail',
    input: { to: emailRecipients(draft.to), cc: emailRecipients(draft.cc), bcc: emailRecipients(draft.bcc), subject: draft.subject, content: draft.body },
  };
  throw new EmailDraftError('unsupported', 'Choose a Gmail or Outlook account');
}

/** Called only by the authenticated owner-viewer procedure. Agents edit drafts, never invoke this. */
export async function sendEmailDraft(id: string, sessionId: string, expectedRevision: number) {
  const current = getEmailDraft(id, sessionId);
  if (current.draft.status === 'sent') return current;
  if (current.draft.status !== 'draft' || current.draft.revision !== expectedRevision) {
    throw new EmailDraftError('conflict', 'This email changed. Review the latest draft before sending');
  }
  const problem = emailSendProblem(current.draft);
  if (problem) throw new EmailDraftError('invalid_params', problem);
  // The durable claim prevents duplicates across windows, retries and server restarts.
  const claimed = transitionEmailDraft(id, sessionId, expectedRevision, 'draft', { status: 'sending', error: null });
  let dispatched = false;
  let outcome;
  let account;
  try {
    account = (await emailAccounts()).find(item => item.id === current.draft.connectionId);
    if (!account) throw new EmailDraftError('invalid_params', 'This sending account is unavailable. Reconnect it or choose another account');
    const runtime = await getIntegrationRuntime();
    const request = emailSendRequest(current.draft, account.provider);
    dispatched = true;
    outcome = await runtime.runAction(request.actionId, request.input, {
      ownerId: getIntegrationOwnerId(), connectionId: account.id, allowedConnectionIds: [account.id], caller: EMAIL_COMPOSER_CALLER,
    });
  } catch (error) {
    // An unexpected failure after dispatch may have delivered. Never invite a blind retry.
    return transitionEmailDraft(id, sessionId, claimed.draft.revision, 'sending', {
      status: dispatched ? 'uncertain' : 'draft',
      fromLabel: account?.label ?? null,
      error: dispatched ? 'Delivery could not be confirmed. Check Sent mail before creating another email' : error instanceof EmailDraftError ? error.message : 'Email is unavailable right now. Try again shortly',
    });
  }
  if (outcome.ok) {
    const result = outcome.result as { id?: unknown } | null;
    if (account.provider === 'google' && (!result || typeof result.id !== 'string' || !result.id)) {
      return transitionEmailDraft(id, sessionId, claimed.draft.revision, 'sending', { status: 'uncertain', fromLabel: account.label, error: 'Delivery could not be confirmed. Check Sent mail before creating another email' });
    }
    return transitionEmailDraft(id, sessionId, claimed.draft.revision, 'sending', {
      status: 'sent', sentAt: new Date().toISOString(), fromLabel: account.label,
      messageId: result && typeof result.id === 'string' ? result.id : null, error: null,
    });
  }
  const uncertain = outcome.reason === 'error' && (outcome.indeterminate || outcome.code === 'internal_error' || (outcome.code === 'provider_error' && (!outcome.status || outcome.status >= 500)));
  const error = uncertain ? 'Delivery could not be confirmed. Check Sent mail before creating another email'
    : outcome.reason === 'needs_consent' || outcome.reason === 'auth_required' ? `Reconnect this account in ${INTEGRATION_LABELS.plural} to allow sending email`
    : outcome.reason === 'error' ? outcome.message
    : `Email was not sent. Check this account in ${INTEGRATION_LABELS.plural} and try again`;
  return transitionEmailDraft(id, sessionId, claimed.draft.revision, 'sending', { status: uncertain ? 'uncertain' : 'draft', fromLabel: account.label, error });
}
