/**
 * Data hooks over `useRiApp().call`. Reads refetch when the host delivers a
 * changed opener result or the input changes, keep showing the previous data
 * while they reload, and ignore responses that arrive out of order. Writes
 * carry an invocation ID that survives a failed attempt, so "Try again"
 * repeats the same logical write and the app deduplicates it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRiApp } from "./app.js";
import { errorMessage, newInvocationId, stableJson } from "./util.js";

export interface QueryResult<T> {
  data: T | undefined;
  error: string | null;
  /** True while a request is in flight, including a background reload. */
  loading: boolean;
  /** True while reloading data that is already shown. */
  refreshing: boolean;
  /** The shown data was loaded for a previous input. Pass `keepPrevious: false` to hide it instead. */
  stale: boolean;
  reload(): Promise<void>;
}

/** Read an action's result. Re-runs on a new opener revision or a different input. */
export function useQuery<T = unknown>(
  action: string,
  input: Record<string, unknown> = {},
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
): QueryResult<T> {
  const { call, revision } = useRiApp();
  const enabled = options.enabled ?? true;
  const key = stableJson(input);
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean; key: string | null }>({
    data: undefined,
    error: null,
    loading: enabled,
    key: null,
  });
  const keyRef = useRef(key);
  keyRef.current = key;
  const sequence = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const id = ++sequence.current;
    const requested = keyRef.current;
    setState((current) => (current.loading ? current : { ...current, loading: true }));
    try {
      const data = (await call(action, inputRef.current)) as T;
      if (mounted.current && id === sequence.current) setState({ data, error: null, loading: false, key: requested });
    } catch (failure) {
      if (mounted.current && id === sequence.current)
        setState((current) => ({ data: current.data, error: errorMessage(failure, "This could not load. Try again."), loading: false, key: current.key }));
    }
  }, [call, action]);

  useEffect(() => {
    if (!enabled) {
      sequence.current++;
      setState((current) => (current.loading ? { ...current, loading: false } : current));
      return;
    }
    void run();
    // `key` stands for the input's content, so a new object with the same values does not refetch.
  }, [run, enabled, key, revision]);

  // Data loaded for different input is still shown while the new input loads,
  // unless the caller opts out (a detail view must never show the previous record).
  const stale = state.data !== undefined && state.key !== key;
  const data = stale && options.keepPrevious === false ? undefined : state.data;
  return {
    data,
    error: state.error,
    loading: state.loading,
    refreshing: state.loading && data !== undefined,
    stale: stale && data !== undefined,
    reload: run,
  };
}

export interface MutationResult<TInput, TResult> {
  /** Run the write. Rejects on failure. A concurrent second run returns the first run's promise. */
  run(input: TInput): Promise<TResult>;
  pending: boolean;
  error: string | null;
  /** Clear the error and start a new logical write with a fresh invocation ID. */
  reset(): void;
  /** The invocation ID the next or current attempt uses, if one has started. */
  invocationId: string | null;
}

/**
 * Run an app write. The first attempt creates an invocation ID. It is kept
 * after a failure, so retrying the same logical submit reuses it, and cleared
 * after success or `reset()`.
 */
export function useMutation<TInput extends Record<string, unknown> = Record<string, unknown>, TResult = unknown>(
  action: string,
): MutationResult<TInput, TResult> {
  const { call } = useRiApp();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invocationId, setInvocationId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const inFlight = useRef<Promise<TResult> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback((input: TInput): Promise<TResult> => {
    if (inFlight.current) return inFlight.current;
    const id = (idRef.current ??= newInvocationId());
    setInvocationId(id);
    setPending(true);
    setError(null);
    const attempt = (async () => {
      try {
        const result = (await call(action, input, { invocationId: id })) as TResult;
        if (idRef.current === id) idRef.current = null;
        if (mounted.current) setInvocationId(idRef.current);
        return result;
      } catch (failure) {
        if (mounted.current) setError(errorMessage(failure, "This change was not saved. Try again."));
        throw failure;
      } finally {
        inFlight.current = null;
        if (mounted.current) setPending(false);
      }
    })();
    inFlight.current = attempt;
    return attempt;
  }, [call, action]);

  const reset = useCallback(() => {
    if (inFlight.current) return;
    idRef.current = null;
    setInvocationId(null);
    setError(null);
  }, []);

  return { run, pending, error, reset, invocationId };
}
