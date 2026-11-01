/** Slack Web API answer: `ok` plus method-specific fields. */
export interface SlackResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export type SlackHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

const MAX_ATTEMPTS = 3;

/**
 * Minimal Slack Web API client: JSON in, JSON out, Retry-After honoured on 429 (SPEC §7.1).
 * Network and 5xx errors retry; Slack's own `ok: false` answers do not.
 */
export class SlackApi {
  constructor(
    private readonly http: SlackHttp = (url, init) => fetch(url, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async call(
    method: string,
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<SlackResult> {
    let last: SlackResult = { ok: false, error: 'unreachable' };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let wait = attempt * 1000;
      try {
        const response = await this.http(`https://slack.com/api/${method}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify(body),
        });
        if (response.status === 429) {
          wait = (Number(response.headers.get('retry-after')) || 1) * 1000;
          last = { ok: false, error: 'ratelimited' };
        } else if (response.status >= 500) {
          last = { ok: false, error: `http_${response.status}` };
        } else {
          return (await response.json()) as SlackResult;
        }
      } catch {
        last = { ok: false, error: 'unreachable' };
      }
      if (attempt < MAX_ATTEMPTS) await this.sleep(Math.min(30_000, wait));
    }
    return last;
  }

  /** Form-encoded call for the OAuth endpoints, which take client credentials, not a token. */
  async form(method: string, fields: Record<string, string>): Promise<SlackResult> {
    try {
      const response = await this.http(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
      return (await response.json()) as SlackResult;
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  }
}
