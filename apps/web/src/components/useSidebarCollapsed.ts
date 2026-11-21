import { useCallback, useEffect, useState } from 'react';
import { typingInField } from './CommandPalette.js';

export const SIDEBAR_COLLAPSED_KEY = 'ordler.sidebarCollapsed';

/** Phones and narrow windows, below Tailwind's `md` breakpoint. */
export const NARROW_SCREEN = '(max-width: 767px)';

function narrowNow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_SCREEN).matches;
}

/** Whether the screen is phone-sized, following rotation and window resizes. */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_SCREEN);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return narrow;
}

/** Without a remembered choice, narrow screens start with the sidebar out of the way. */
function readCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // Blocked storage: fall through to the screen-width default.
  }
  return narrowNow();
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Private mode or blocked storage: the choice lasts until the next reload.
  }
}

/**
 * Collapsed state of the left sidebar, remembered per browser. Toggles on "[" outside text
 * fields (as in Linear) and on Cmd/Ctrl+\. On phones the open sidebar is a drawer over the
 * page: it starts closed and opening it is not remembered, so a reload never covers the page.
 * `close` shuts it without remembering, for the drawer closing itself.
 */
export function useSidebarCollapsed(): [boolean, () => void, () => void] {
  const [collapsed, setCollapsed] = useState(() => narrowNow() || readCollapsed());

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      if (!narrowNow()) writeCollapsed(!current);
      return !current;
    });
  }, []);
  const close = useCallback(() => setCollapsed(true), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modified = event.metaKey || event.ctrlKey;
      // The physical key counts too, so the shortcut works on layouts such as Russian ("х").
      const bracket =
        (event.key === '[' || event.code === 'BracketLeft') &&
        !modified &&
        !event.altKey &&
        !typingInField(event.target);
      const backslash =
        (event.key === '\\' || event.code === 'Backslash') &&
        modified &&
        !event.altKey &&
        !event.shiftKey;
      if (!bracket && !backslash) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return [collapsed, toggle, close];
}
