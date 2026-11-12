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
          wikiPages: [
            {
              id: 'w1',
              title: 'VPN setup',
              department: { id: 'd1', name: 'IT' },
              snippet: '',
              updatedAt: '2026-11-12T00:00:00Z',
            },
          ],
        },
      }),
    });
    const onClose = vi.fn();
    await renderWithI18n(<CommandPalette onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'vpn');
    expect(await screen.findByText('VPN drops')).toBeInTheDocument();
    expect(screen.getByText('VPN access')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Wiki' })).toHaveTextContent('VPN setup');
    expect(screen.getByRole('group', { name: 'Issues' })).toHaveTextContent('HELP-4');
    expect(calls.filter((c) => c.path.startsWith('/api/search'))).toHaveLength(1);

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(window.location.pathname).toBe('/requests/REQ-7');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows how to search before anything is typed and opens wiki pages', async () => {
    mockApi({
      'GET /api/search?q=onboarding': () => ({
        json: {
          issues: [],
          requests: [],
          wikiPages: [
            {
              id: 'w9',
              title: 'Onboarding',
              department: { id: 'd1', name: 'HR' },
              snippet: '',
              updatedAt: '2026-11-12T00:00:00Z',
            },
          ],
        },
      }),
    });
    await renderWithI18n(<CommandPalette onClose={vi.fn()} />, 'ru');
    expect(screen.getByText(/HELP-12, REQ-3 или просто 12/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Поиск' }), 'onboarding');
    expect(await screen.findByRole('group', { name: 'Вики' })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/wiki/page/w9');
  });

  it('says when nothing matches and closes on Escape', async () => {
    mockApi({
      'GET /api/search?q=zzz': () => ({ json: { issues: [], requests: [], wikiPages: [] } }),
    });
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
  const press = (init: KeyboardEventInit, target: EventTarget = window) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      );
    });

  it('toggles with Ctrl+K', async () => {
    await renderWithI18n(<Probe />);
    expect(screen.getByText('closed')).toBeInTheDocument();
    press({ key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('open')).toBeInTheDocument());
    press({ key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('closed')).toBeInTheDocument());
  });

  it('replaces the browser find on Cmd/Ctrl+F', async () => {
    await renderWithI18n(<Probe />);
    const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText('open')).toBeInTheDocument());
  });

  it('opens on "/" but not while typing in a field', async () => {
    await renderWithI18n(
      <>
        <Probe />
        <input aria-label="Title" />
      </>,
    );
    press({ key: '/' }, screen.getByRole('textbox', { name: 'Title' }));
    expect(screen.getByText('closed')).toBeInTheDocument();
    press({ key: '/' }, document.body);
    await waitFor(() => expect(screen.getByText('open')).toBeInTheDocument());
  });
});
