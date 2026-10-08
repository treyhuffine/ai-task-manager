/** Shared limit for scoped handoff and review workflow guidance. */
export const WORK_RESULT_GUIDANCE_MAX = 20_000;

export class WorkResultGuidanceError extends Error {
  readonly code = 'invalid_params';

  constructor(message: string) {
    super(message);
    this.name = 'WorkResultGuidanceError';
  }
}

export function normalizeWorkResultGuidance(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new WorkResultGuidanceError('Workflow guidance must be text or empty.');
  }
  const text = value.trim();
  if (text.length > WORK_RESULT_GUIDANCE_MAX) {
    throw new WorkResultGuidanceError('Workflow guidance must be 20,000 characters or fewer.');
  }
  return text || null;
}
