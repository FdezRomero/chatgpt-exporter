export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const defaultOptions: RetryOptions = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 60000,
};

function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === opts.maxRetries) {
        break;
      }

      if (
        lastError.name === 'AuthenticationError' ||
        (lastError.name === 'NetworkError' && (lastError as { statusCode?: number }).statusCode === 404)
      ) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
      opts.onRetry?.(lastError, attempt + 1, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
