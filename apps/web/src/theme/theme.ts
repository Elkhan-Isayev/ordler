import { isTheme, type Theme } from '@ordler/shared';

const STORAGE_KEY = 'ordler.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let current: Theme = 'system';
let unwatchSystem: (() => void) | undefined;

function systemDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false;
}

/** The last theme used on this device, so the first paint matches before /api/me answers. */
export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function currentTheme(): Theme {
  return current;
}

function paint() {
  const dark = current === 'dark' || (current === 'system' && systemDark());
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** Applies a theme to the page and remembers it on this device. */
export function applyTheme(theme: Theme) {
  current = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the server copy still restores it after sign-in.
  }
  unwatchSystem?.();
  unwatchSystem = undefined;
  if (theme === 'system') {
    const query = window.matchMedia?.(DARK_QUERY);
    if (query) {
      query.addEventListener('change', paint);
      unwatchSystem = () => query.removeEventListener('change', paint);
    }
  }
  paint();
}
