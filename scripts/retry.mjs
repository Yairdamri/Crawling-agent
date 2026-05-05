export const RETRY_DELAYS_MS = [1000, 4000];

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isTransient(err) {
  const code = err?.$metadata?.httpStatusCode || err?.status || err?.statusCode;
  if (code >= 500 && code < 600) return true;
  if (code === 429) return true;
  const name = err?.name || '';
  if (name === 'ThrottlingException' || name === 'TooManyRequestsException') return true;
  if (name === 'ServiceUnavailableException' || name === 'InternalServerException') return true;
  if (name === 'ModelTimeoutException') return true;
  const msg = err?.message || '';
  return /timeout|ECONN|ENETUNREACH|EAI_AGAIN|socket hang up/i.test(msg);
}

export async function withRetry(fn, label, { logger = console.warn, shouldRetry = isTransient } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = shouldRetry(err);
      const isLast = attempt === RETRY_DELAYS_MS.length;
      if (!retryable || isLast) throw err;
      const wait = RETRY_DELAYS_MS[attempt];
      logger(`${label} attempt ${attempt + 1} failed (${err.message}). Retrying in ${wait}ms.`);
      await sleep(wait);
    }
  }
  throw lastErr;
}
