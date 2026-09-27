/** Small, read-only native menu snapshot. No transcript, attachment, path or
 * execution credentials cross this boundary. Counts mirror the rail. */
export const DESKTOP_ACTIVITY_TARGET_LIMIT = 5;
export const DESKTOP_ACTIVITY_LABEL_LIMIT = 100;
export type DesktopActivityKind = 'needsInput' | 'unread' | 'running';
export interface DesktopActivityTarget {
  sessionId: string;
  label: string;
  state: DesktopActivityKind;
}
export interface DesktopActivityData {
  running: number;
  needsInput: number;
  unread: number;
  attention: number;
  targets: DesktopActivityTarget[];
}
export interface DesktopActivitySnapshot {
  connection: 'connecting' | 'connected' | 'disconnected';
  activity?: DesktopActivityData;
  updatedAt?: number;
}

// Native menu targets can select a session only. They never select an API,
// external URL, privileged operation, fragment, or filesystem location.
const validSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function desktopActivityPath(sessionId: string): string {
  return validSessionId(sessionId) ? `/?session=${encodeURIComponent(sessionId)}` : '/';
}

export function desktopActivityLabel(value: string | null | undefined): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, DESKTOP_ACTIVITY_LABEL_LIMIT) || 'Untitled';
}

/** The main process validates the complete small response before replacing
 * its menu. Malformed or inconsistent snapshots are disconnected, not idle. */
export function readDesktopActivity(value: unknown): DesktopActivityData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop activity');
  const row = value as Record<string, unknown>;
  for (const key of ['running', 'needsInput', 'unread', 'attention'] as const) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0 || (row[key] as number) > 1_000_000) throw new Error('Invalid desktop activity count');
  }
  if (row.attention !== (row.needsInput as number) + (row.unread as number)) throw new Error('Inconsistent desktop activity');
  if (!Array.isArray(row.targets) || row.targets.length > DESKTOP_ACTIVITY_TARGET_LIMIT) throw new Error('Invalid desktop activity targets');
  const ids = new Set<string>();
  const counts = { running: 0, needsInput: 0, unread: 0 };
  const targets = row.targets.map((raw: unknown): DesktopActivityTarget => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid desktop activity target');
    const target = raw as Record<string, unknown>;
    if (!validSessionId(target.sessionId) || ids.has(target.sessionId) || typeof target.label !== 'string' || target.label.length > DESKTOP_ACTIVITY_LABEL_LIMIT
      || (target.state !== 'running' && target.state !== 'needsInput' && target.state !== 'unread')) throw new Error('Invalid desktop activity target');
    ids.add(target.sessionId);
    counts[target.state] += 1;
    if (counts[target.state] > (row[target.state] as number)) throw new Error('Inconsistent desktop activity target');
    return { sessionId: target.sessionId, label: desktopActivityLabel(target.label), state: target.state };
  });
  return { running: row.running as number, needsInput: row.needsInput as number, unread: row.unread as number,
    attention: row.attention as number, targets };
}
