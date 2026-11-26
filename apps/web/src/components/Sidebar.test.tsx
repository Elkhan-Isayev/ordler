import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Locale } from '@ordler/shared';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { createI18n } from '../i18n/index.js';
import { formatBadge, Sidebar, type SidebarProps } from './Sidebar.js';

const props: SidebarProps = {
  workspaceName: 'Push30',
  inboxCount: 120,
  pendingApprovals: 3,
  departments: [
    {
      id: 'it',
      name: 'IT',
      teams: [
        { id: 't1', key: 'HELP', name: 'Helpdesk' },
        { id: 't2', key: 'INFRA', name: 'Infrastructure' },
      ],
    },
    { id: 'fin', name: 'Finance', teams: [{ id: 't3', key: 'ACC', name: 'Accounting' }] },
  ],
};

async function renderSidebar(locale: Locale = 'en', overrides: Partial<SidebarProps> = {}) {
  const i18n = await createI18n(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <Sidebar {...props} {...overrides} />
    </I18nextProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Sidebar', () => {
  it('offers the source code of the running version (AGPL §13)', async () => {
    mockApi({
      'GET /api/about': () => ({
        json: {
          version: '0.9.0',
          license: 'AGPL-3.0-only',
          sourceUrl: 'https://git.acme.test/ordler',
        },
      }),
    });
    await renderSidebar();
    const link = await screen.findByRole('link', { name: 'Source code' });
    expect(link).toHaveAttribute('href', 'https://git.acme.test/ordler');
    expect(await screen.findByText(/Ordler 0\.9\.0 · AGPL-3\.0/)).toBeInTheDocument();
  });

  it('still links the public source when the server cannot say', async () => {
    mockApi({ 'GET /api/about': () => ({ status: 500, json: { error: 'internal' } }) });
    await renderSidebar('ru');
    expect(screen.getByRole('link', { name: 'Исходный код' })).toHaveAttribute(
      'href',
      'https://github.com/Elkhan-Isayev/ordler',
    );
  });

  it('shows a search field with its shortcut that opens the search', async () => {
    const onSearch = vi.fn();
    await renderSidebar('ru', { onSearch });
    const field = screen.getByRole('button', { name: /Поиск/ });
    expect(field).toHaveTextContent(/K$/);
    await userEvent.click(field);
    expect(onSearch).toHaveBeenCalled();
  });

  it('shows personal, workspace and department navigation', async () => {
    await renderSidebar();
    for (const label of ['Inbox', 'My issues', 'My requests', 'Approvals', 'Service portals']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Your departments' })).toBeInTheDocument();
  });

  it('links Help right after Approvals and highlights it on /help', async () => {
    await renderSidebar('en', { currentPath: '/help' });
    const links = screen.getAllByRole('link').map((link) => link.textContent);
    const approvals = links.findIndex((text) => text?.startsWith('Approvals'));
    expect(links[approvals + 1]).toBe('Help');
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
  });

  it('caps the inbox badge and labels the approvals badge', async () => {
    await renderSidebar();
    expect(
      within(screen.getByRole('link', { name: /Inbox/ })).getByText('99+'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('3 approvals waiting')).toHaveTextContent('3');
  });

  it('opens the first department and lets teams expand', async () => {
    await renderSidebar();
    const it = screen.getByRole('button', { name: /IT/ });
    expect(it).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Finance/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await userEvent.click(screen.getByRole('button', { name: /Helpdesk/ }));
    expect(screen.getByRole('link', { name: 'Triage' })).toHaveAttribute(
      'href',
      '/teams/HELP/triage',
    );
    expect(screen.getByRole('link', { name: 'Issues' })).toHaveAttribute(
      'href',
      '/teams/HELP/issues',
    );
  });

  it('shows team settings only to those who manage the team', async () => {
    const departments = [
      {
        id: 'it',
        name: 'IT',
        teams: [
          { id: 't1', key: 'HELP', name: 'Helpdesk', manage: true },
          { id: 't2', key: 'INFRA', name: 'Infrastructure' },
        ],
      },
    ];
    await renderSidebar('en', { departments });
    await userEvent.click(screen.getByRole('button', { name: /Helpdesk/ }));
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/teams/HELP/settings',
    );
    await userEvent.click(screen.getByRole('button', { name: /Helpdesk/ }));
    await userEvent.click(screen.getByRole('button', { name: /Infrastructure/ }));
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('links the department request queue only to those who may read it', async () => {
    const departments = [
      { id: 'it', name: 'IT', readRequests: true, teams: [] },
      { id: 'fin', name: 'Finance', teams: [] },
    ];
    await renderSidebar('en', { departments });
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute(
      'href',
      '/departments/it/requests',
    );
    await userEvent.click(screen.getByRole('button', { name: /IT/ }));
    await userEvent.click(screen.getByRole('button', { name: /Finance/ }));
    expect(screen.queryByRole('link', { name: 'Requests' })).not.toBeInTheDocument();
  });

  it('collapses a department', async () => {
    await renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: /IT/ }));
    expect(screen.queryByRole('button', { name: /Helpdesk/ })).not.toBeInTheDocument();
  });

  it('hides the departments section when the member has none', async () => {
    await renderSidebar('en', { departments: [] });
    expect(screen.queryByRole('heading', { name: 'Your departments' })).not.toBeInTheDocument();
  });

  it('renders in Russian', async () => {
    await renderSidebar('ru');
    expect(screen.getByRole('link', { name: /Входящие/ })).toBeInTheDocument();
    expect(screen.getByLabelText('3 согласования ожидают')).toBeInTheDocument();
  });

  it('hides badges for zero counts', async () => {
    await renderSidebar('en', { inboxCount: 0, pendingApprovals: 0 });
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/approvals waiting/)).not.toBeInTheDocument();
  });
});

describe('formatBadge', () => {
  it.each([
    [0, undefined],
    [-1, undefined],
    [7, '7'],
    [99, '99'],
    [100, '99+'],
  ])('%i → %s', (count, expected) => {
    expect(formatBadge(count)).toBe(expected);
  });
});

describe('Sidebar administration link', () => {
  it('is shown only to administrators and highlights the admin area', async () => {
    const { unmount } = await renderSidebar('en', { showAdmin: false });
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    unmount();
    await renderSidebar('en', { showAdmin: true, currentPath: '/admin/members' });
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('collapses to a rail and expands again from its button', async () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = await renderSidebar('en', { onToggleCollapsed });
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(collapse).toHaveAttribute('title', expect.stringMatching(/^Collapse sidebar \(\[/));
    await userEvent.click(collapse);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    const i18n = await createI18n('ru');
    rerender(
      <I18nextProvider i18n={i18n}>
        <Sidebar {...props} collapsed onToggleCollapsed={onToggleCollapsed} />
      </I18nextProvider>,
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Развернуть боковую панель' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expand.focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it('opens over the page as a drawer on phones and closes when the page is tapped', async () => {
    const onToggleCollapsed = vi.fn();
    await renderSidebar('en', { onToggleCollapsed, overlay: true });
    const nav = screen.getByRole('navigation', { name: 'Push30' });
    // Fixed over the page instead of taking the page's width.
    expect(nav.className).toContain('fixed');
    await userEvent.click(screen.getByTestId('sidebar-backdrop'));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('stays in the page flow on wide screens', async () => {
    await renderSidebar('en', { onToggleCollapsed: vi.fn() });
    expect(screen.getByRole('navigation', { name: 'Push30' }).className).not.toContain('fixed');
    expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument();
  });

  it('has no collapse button when the shell cannot collapse it', async () => {
    await renderSidebar('en', { collapsed: true });
    expect(screen.getByRole('navigation', { name: 'Push30' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sidebar/ })).not.toBeInTheDocument();
  });
});
