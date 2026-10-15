import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Locale } from '@ordler/shared';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
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

describe('Sidebar', () => {
  it('shows personal, workspace and department navigation', async () => {
    await renderSidebar();
    for (const label of ['Inbox', 'My issues', 'My requests', 'Approvals', 'Service portals']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Your departments' })).toBeInTheDocument();
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
