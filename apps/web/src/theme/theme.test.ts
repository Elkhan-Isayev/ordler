import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, currentTheme, storedTheme } from './theme.js';

function stubSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    listeners,
    flip(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

const painted = () => document.documentElement.dataset.theme;

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  applyTheme('system');
});

describe('theme', () => {
  it('paints an explicit choice whatever the operating system prefers', () => {
    stubSystem(true);
    applyTheme('light');
    expect(painted()).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    applyTheme('dark');
    expect(painted()).toBe('dark');
    expect(currentTheme()).toBe('dark');
  });

  it('follows the operating system only on "system"', () => {
    const system = stubSystem(false);
    applyTheme('system');
    expect(painted()).toBe('light');
    system.flip(true);
    expect(painted()).toBe('dark');

    applyTheme('light');
    expect(system.listeners.size).toBe(0);
    system.flip(false);
    system.flip(true);
    expect(painted()).toBe('light');
  });

  it('remembers the choice on this device and ignores junk in storage', () => {
    stubSystem(false);
    expect(storedTheme()).toBe('system');
    applyTheme('dark');
    expect(storedTheme()).toBe('dark');
    window.localStorage.setItem('ordler.theme', 'sepia');
    expect(storedTheme()).toBe('system');
  });
});
