export interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
  secure: boolean;
  /** Lax lets the OAuth redirect back from Google carry the state cookie on a top-level GET. */
  sameSite?: 'Lax' | 'Strict';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      // Malformed percent-encoding: ignore this cookie rather than fail the request.
    }
  }
  return cookies;
}

/** Always HttpOnly: no Ordler cookie is meant for client-side scripts. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`, 'HttpOnly'];
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.secure) parts.push('Secure');
  if (options.maxAgeSeconds !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  return parts.join('; ');
}

export function clearCookie(name: string, options: Omit<CookieOptions, 'maxAgeSeconds'>): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}
