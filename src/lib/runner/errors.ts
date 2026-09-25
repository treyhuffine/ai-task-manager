/** Errors a send or a session start can end in, for the home to show. */
export class ExecutorError extends Error {
  constructor(
    public code:
      | 'not_found'
      | 'invalid_state'
      | 'unsupported'
      | 'already_running'
      | 'budget_exceeded',
    message: string,
  ) {
    super(message);
    this.name = 'ExecutorError';
  }
}
