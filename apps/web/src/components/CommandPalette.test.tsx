import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issue } from '../issues/fixtures.js';
import { request } from '../requests/fixtures.js';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { CommandPalette, useCommandPalette } from './CommandPalette.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('CommandPalette', () => {
  it('searches issues and requests and opens the chosen one with the keyboard', async () => {
    const calls = mockApi({
      'GET /api/search?q=vpn': () => ({
        json: {
          issues: [issue(4, { title: 'VPN drops' })],
          requests: [request({ title: 'VPN access' })],
        },
      }),
    });
    const onClose = vi.fn();
    await renderWithI18n(<CommandPalette onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'vpn');
    expect(await screen.findByText('VPN drops')).toBeInTheDocument();
    expect(screen.getByText('VPN access')).toBeInTheDocument();
    expect(calls.filter((c) => c.path.startsWith('/api/search'))).toHaveLength(1);

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(window.location.pathname).toBe('/requests/REQ-7');
    expect(onClose).toHaveBeenCalled();
  });

  it('says when nothing matches and closes on Escape', async () => {
    mockApi({ 'GET /api/search?q=zzz': () => ({ json: { issues: [], requests: [] } }) });
    const onClose = vi.fn();
    await renderWithI18n(<CommandPalette onClose={onClose} />, 'de');
    await userEvent.type(screen.getByRole('textbox', { name: 'Suche' }), 'zzz');
    expect(await screen.findByText('Nichts gefunden.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

function Probe() {
  const [open] = useCommandPalette();
  return <span>{open ? 'open' : 'closed'}</span>;
}

describe('useCommandPalette', () => {
  it('toggles with Ctrl+K', async () => {
    await renderWithI18n(<Probe />);
    expect(screen.getByText('closed')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    await waitFor(() => expect(screen.getByText('open')).toBeInTheDocument());
  });
});
