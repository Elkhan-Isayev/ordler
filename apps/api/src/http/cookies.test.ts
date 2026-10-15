import { describe, expect, it } from 'vitest';
import { clearCookie, parseCookies, serializeCookie } from './cookies.js';

describe('parseCookies', () => {
  it('parses and decodes cookies', () => {
    expect(parseCookies('a=1; ordler_session=abc%2Fdef ; b=two')).toEqual({
      a: '1',
      ordler_session: 'abc/def',
      b: 'two',
    });
  });

  it('keeps the first occurrence and skips junk', () => {
    expect(parseCookies('x=1; x=2; novalue; =empty; bad=%E0%A4%A')).toEqual({ x: '1' });
  });

  it('handles a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('serializeCookie', () => {
  it('sets HttpOnly, SameSite and Secure', () => {
    expect(serializeCookie('s', 'v/1', { secure: true, maxAgeSeconds: 60 })).toBe(
      's=v%2F1; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60',
    );
  });

  it('omits Secure on plain HTTP and honours the path', () => {
    expect(serializeCookie('s', 'v', { secure: false, path: '/api/auth' })).toBe(
      's=v; Path=/api/auth; HttpOnly; SameSite=Lax',
    );
  });

  it('clears with Max-Age=0', () => {
    expect(clearCookie('s', { secure: false })).toBe(
      's=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });
});
