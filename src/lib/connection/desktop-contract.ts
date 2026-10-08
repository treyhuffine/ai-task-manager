/** Public presentation only. No credentials, paths or native capabilities. */
export interface DesktopConnectionIssue {
  kind: 'network' | 'sign_in' | 'certificate' | 'attention';
  message: string;
  detail: string;
  retryable: boolean;
}

export interface DesktopConnectionState {
  phase: 'connecting' | 'connected' | 'failed';
  issue: DesktopConnectionIssue | null;
  showNotice: boolean;
}

export type DesktopConnectionAction = 'status' | 'retry' | 'settings' | 'connect';
export const CONNECTION_NOTICE_DELAY_MS = 10_000;
