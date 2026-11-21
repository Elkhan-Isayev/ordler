import { useCallback, useEffect, useState } from 'react';
import { typingInField } from './CommandPalette.js';

export const SIDEBAR_COLLAPSED_KEY = 'ordler.sidebarCollapsed';

/** Without a remembered choice, narrow screens start with the sidebar out of the way. */
function readCollapsed(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // Blocked storage: fall through to the screen-width default.
  }
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 767px)').matches
    : false;
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
 * fields (as in Linear) and on Cmd/Ctrl+\.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  }, []);

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

  return [collapsed, toggle];
}
