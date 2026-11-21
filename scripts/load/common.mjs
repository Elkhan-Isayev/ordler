// Shared helpers for the load-test scripts: a tiny cookie-aware HTTP client and a worker pool.
// Node 24 only (global fetch and WebSocket); no dependencies, so the scripts run in a bare node image.

export const BASE = process.env.ORDLER_URL ?? 'http://localhost:3100';
/** Test-only password for the throwaway load database; never used anywhere real. */
export const PASSWORD = 'load-test-password-1';

export class Client {
  /** `ip` goes out as X-Forwarded-For, so each simulated person has their own address. */
  constructor(cookie = '', ip = undefined) {
    this.cookie = cookie;
    this.ip = ip;
  }

  async call(method, path, body) {
    const headers = { origin: BASE, accept: 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.ip) headers['x-forwarded-for'] = this.ip;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.getSetCookie?.() ?? [];
    const session = set.find((c) => c.startsWith('ordler_session='));
    if (session) this.cookie = session.split(';')[0];
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: response.status, data };
  }

  /** Like call(), but throws on anything other than 2xx. */
  async ok(method, path, body) {
    const result = await this.call(method, path, body);
    if (result.status >= 300) {
      throw new Error(`${method} ${path} → ${result.status} ${JSON.stringify(result.data)}`);
    }
    return result.data;
  }
}

/** Runs fn over items with at most `size` in flight. */
export async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/** Deterministic pseudo-random numbers, so two seeds of the same size look alike. */
export function random(seed = 42) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

/** A stable private address for simulated person n. */
export function ipOf(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}
