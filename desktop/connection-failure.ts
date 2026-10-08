import type { DesktopConnectionIssue } from '../src/lib/connection/desktop-contract';
import { DesktopSessionError } from './session-auth';

/** Preserve structured causes across helper IPC instead of guessing from
 * prose or labelling every failure as a sleeping remote computer. */
export function connectionFailure(error: unknown, local = false): DesktopConnectionIssue {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : 'The connection could not be completed. Try again.';
  const problem = (error as { problem?: string } | null)?.problem;
  const code = (error as { code?: string } | null)?.code;
  if (problem === 'unauthorized' || error instanceof DesktopSessionError && ['credential', 'forbidden'].includes(error.code)) {
    if (local) return { kind: 'attention', message: 'The local Ri service needs attention.', detail, retryable: false };
    return { kind: 'sign_in', message: 'This computer needs to sign in again.', detail, retryable: false };
  }
  if (problem === 'untrusted_certificate') {
    return { kind: 'certificate', message: 'Ri could not verify the connection’s certificate.', detail, retryable: false };
  }
  if (problem === 'unreachable' || (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)) || error instanceof DesktopSessionError && (['network', 'timeout', 'server'].includes(error.code) || error.status === 429)) {
    return { kind: 'network', message: 'Reconnecting to Ri…', detail, retryable: true };
  }
  return { kind: 'attention', message: 'The Ri connection needs attention.', detail, retryable: false };
}
