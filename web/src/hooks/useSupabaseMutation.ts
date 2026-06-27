"use client";

import { useCallback, useState } from "react";

export interface UseSupabaseMutationResult<TArgs extends unknown[], R> {
  run: (...args: TArgs) => Promise<R>;
  pending: boolean;
  error: string | null;
}

/**
 * Generic `{ pending, error, run }` wrapper for any async mutation. Every
 * settings-write + spend-request-write hook was reimplementing the same
 * `setPending(true) / try / catch (setError) / finally setPending(false)`
 * scaffold around one Supabase call — this collapses that to one place.
 *
 * The wrapped function's return value flows back to the caller from `run`.
 * If it throws, the wrapper captures the message into `error` and re-throws
 * so the caller can still `try / await run(...)` or `await run(...).catch()`.
 */
export function useSupabaseMutation<TArgs extends unknown[], R>(
  fn: (...args: TArgs) => Promise<R>,
): UseSupabaseMutationResult<TArgs, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<R> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );

  return { run, pending, error };
}
