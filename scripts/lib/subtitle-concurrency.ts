/**
 * Run bounded concurrent work and preserve input order. Once a failure or abort
 * is observed, stop taking new items and drain every in-flight worker before
 * rejecting, so callers can safely release shared state/process locks.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("Concurrency must be a positive safe integer.");
  }
  signal.throwIfAborted();
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  // Keep an explicit flag: JavaScript permits throwing undefined or null.
  let failed = false;
  let firstError: unknown;
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    firstError = error;
  };
  const onAbort = () => fail(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });

  const run = async () => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        fail(error);
      }
    }
  };

  try {
    // Guard cancellation between the initial check and listener registration.
    if (signal.aborted) onAbort();
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
    if (failed) throw firstError;
    return results;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
