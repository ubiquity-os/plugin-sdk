interface RetryOptions {
  maxRetries: number;
  onError?: (error: unknown) => Promise<void> | void;
  /** Return `false` to stop retrying, `true` to automatically delay the next retry, or a number to set the delay before the next retry */
  isErrorRetryable?: (error: unknown) => Promise<boolean | number> | boolean | number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let delay = 1000;
  let lastError: unknown = null;
  for (let i = 0; i < options.maxRetries + 1; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (options.onError) {
        await options.onError(err);
      }
      let shouldRetry;
      if (options.isErrorRetryable) {
        shouldRetry = await options.isErrorRetryable(err);
      }
      if (shouldRetry === false) {
        throw lastError;
      } else if (typeof shouldRetry === "number" && Number.isFinite(shouldRetry)) {
        await sleep(shouldRetry);
      } else {
        await sleep(delay);
        delay *= 2;
      }
    }
  }
  throw lastError;
}
