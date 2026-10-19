import type { Caller } from '@integrations/engine';

/** Stamped only by the owner-viewer Send procedure, never from agent input. */
export const EMAIL_COMPOSER_CALLER: Caller = { type: 'app', id: 'email-composer' };
export function isEmailComposerSend(caller: Caller | undefined, actionId: string): boolean {
  return caller?.type === 'app' && caller.id === EMAIL_COMPOSER_CALLER.id
    && (actionId === 'gmail.send_email' || actionId === 'outlook_mail.send_mail');
}
