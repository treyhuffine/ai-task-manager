/** Serialize controller reconnects and local Open retries. A candidate remains
 * retryable until its session and document are both accepted. Old monitors are
 * replaced only at commit, never while an unverified session is being staged. */
export class ViewerTransitions<T> {
  current: T | undefined;
  pending: T | undefined;
  private tail: Promise<void> = Promise.resolve();

  run(target: T, steps: {
    prepare(previous: T | undefined): Promise<boolean>;
    stage(): Promise<void>;
    open(previous: T | undefined): Promise<void>;
    rollback(previous: T | undefined): void | Promise<void>;
    commit(): void;
  }): Promise<void> {
    const attempt = this.tail.then(async () => {
      this.pending = target;
      const previous = this.current;
      try {
        if (!await steps.prepare(previous)) return;
        await steps.stage();
        await steps.open(previous);
      } catch (error) {
        await steps.rollback(previous);
        throw error;
      }
      this.current = target;
      this.pending = undefined;
      steps.commit();
    });
    this.tail = attempt.catch(() => {});
    return attempt;
  }
}
