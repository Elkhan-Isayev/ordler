import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_COLLAPSED_KEY,
  useNarrowScreen,
  useSidebarCollapsed,
} from './useSidebarCollapsed.js';

function press(init: KeyboardEventInit, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSidebarCollapsed', () => {
  it('starts expanded and remembers the toggled state across reloads', () => {
    const first = renderHook(() => useSidebarCollapsed());
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1]());
    expect(first.result.current[0]).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');
    first.unmount();

    const reloaded = renderHook(() => useSidebarCollapsed());
    expect(reloaded.result.current[0]).toBe(true);
    act(() => reloaded.result.current[1]());
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
  });

  it('toggles on "[" and on Cmd/Ctrl+\\', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    press({ key: '[' });
    expect(result.current[0]).toBe(true);
    press({ key: '\\', metaKey: true });
    expect(result.current[0]).toBe(false);
    press({ key: '\\', ctrlKey: true });
    expect(result.current[0]).toBe(true);
  });

  it('follows the physical keys on other layouts', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    press({ key: 'х', code: 'BracketLeft' });
    expect(result.current[0]).toBe(true);
    press({ key: 'ё', code: 'Backslash', ctrlKey: true });
    expect(result.current[0]).toBe(false);
  });

  it('leaves "[" to text fields and ignores a plain backslash', () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    const input = document.createElement('input');
    document.body.append(input);
    press({ key: '[' }, input);
    press({ key: 'х', code: 'BracketLeft' }, input);
    press({ key: '\\' });
    press({ key: '[', ctrlKey: true });
    expect(result.current[0]).toBe(false);
    input.remove();
  });

  it('on phones starts closed and never remembers opening the drawer', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }));
    // Even a desktop choice to keep it open does not cover the page on a phone.
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    const phone = renderHook(() => useSidebarCollapsed());
    expect(phone.result.current[0]).toBe(true);

    act(() => phone.result.current[1]());
    expect(phone.result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
    act(() => phone.result.current[2]());
    expect(phone.result.current[0]).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
  });

  it('reports phone-sized screens and follows changes', () => {
    let listener: (() => void) | undefined;
    const query = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => (listener = fn),
      removeEventListener: () => {},
    };
    vi.stubGlobal('matchMedia', () => query);
    const narrow = renderHook(() => useNarrowScreen());
    expect(narrow.result.current).toBe(true);
    query.matches = false;
    act(() => listener?.());
    expect(narrow.result.current).toBe(false);
  });

  it('still works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });
});
