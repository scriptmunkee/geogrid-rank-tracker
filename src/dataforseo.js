// Minimal DataForSEO client: one Live task per request, with retries.

const API = 'https://api.dataforseo.com/v3';

export class DataForSEOError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function hasCredentials(env) {
  return Boolean(env && env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST a single Live task and return tasks[0]. Retries rate limits and server errors. */
export async function postLiveTask(env, path, task, { retries = 3 } = {}) {
  if (!hasCredentials(env)) throw new DataForSEOError('DataForSEO credentials are not set', 'no_credentials');
  const auth = `Basic ${btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`)}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify([task]),
      });
      if (res.status === 401) throw new DataForSEOError('DataForSEO rejected the login or password', 'auth');
      if (res.status === 429 || res.status >= 500) throw new DataForSEOError(`HTTP ${res.status}`, 'retry');

      const body = await res.json();
      if (body.status_code !== 20000) {
        const retryable = body.status_code === 40202 || body.status_code >= 50000; // 40202 = rate limit
        throw new DataForSEOError(body.status_message || 'DataForSEO error', retryable ? 'retry' : String(body.status_code));
      }
      const t = body.tasks && body.tasks[0];
      if (!t) throw new DataForSEOError('Empty task response', 'empty');
      if (t.status_code === 40102) return { ...t, result: [{ items: [] }] }; // No Search Results
      if (t.status_code !== 20000) {
        throw new DataForSEOError(t.status_message || 'Task failed', t.status_code >= 50000 ? 'retry' : String(t.status_code));
      }
      return t;
    } catch (err) {
      lastErr = err;
      const retryable = err.code === 'retry' || err.name === 'TypeError'; // TypeError = network failure
      if (!retryable || attempt === retries) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Run async fn over items with a concurrency limit. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
