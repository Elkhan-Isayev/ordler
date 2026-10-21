import type { ChatSubscriptionView } from '@ordler/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DEPARTMENTS } from './fixtures.js';
import { IntegrationsSection } from './IntegrationsSection.js';

afterEach(() => vi.unstubAllGlobals());

const SUB: ChatSubscriptionView = {
  id: 's1',
  team: { id: 't1', key: 'HELP', name: 'Helpdesk' },
  name: '#helpdesk',
  host: 'hooks.slack.com',
  events: ['issue_created'],
  createdAt: '2026-10-20T09:00:00Z',
};

describe('IntegrationsSection', () => {
  it('connects a channel with a write-only webhook URL', async () => {
    let subs: ChatSubscriptionView[] = [];
    const calls = mockApi({
      'GET /api/integrations/slack': () => ({ json: subs }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'POST /api/integrations/slack': () => {
        subs = [SUB];
        return { status: 201, json: SUB };
      },
    });
    await renderWithI18n(<IntegrationsSection />);
    expect(await screen.findByText('No channels connected yet.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Channel name'), '#helpdesk');
    const url = screen.getByLabelText(/Incoming webhook URL/);
    await userEvent.type(url, 'https://hooks.slack.com/services/T/B/x');
    await userEvent.click(screen.getByLabelText('Comments'));
    await userEvent.click(screen.getByRole('button', { name: 'Connect a channel' }));

    const posted = calls.find((c) => c.method === 'POST')!;
    expect(posted.body).toMatchObject({
      name: '#helpdesk',
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      events: ['issue_created', 'issue_commented', 'request_received', 'approval_requested'],
    });
    expect(url).toHaveValue('');
    expect(await screen.findByText(/Helpdesk · hooks.slack.com/)).toBeInTheDocument();
  });

  it('sends a test message and removes a channel', async () => {
    const calls = mockApi({
      'GET /api/integrations/slack': () => ({ json: [SUB] }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'POST /api/integrations/slack/s1/test': () => ({ json: { sent: false, status: 404 } }),
      'DELETE /api/integrations/slack/s1': () => ({ status: 204 }),
    });
    await renderWithI18n(<IntegrationsSection />, 'de');
    await userEvent.click(await screen.findByRole('button', { name: 'Testnachricht senden' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Slack antwortete 404');
    await userEvent.click(screen.getByRole('button', { name: '#helpdesk entfernen' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});

describe('IntegrationsSection for one team', () => {
  it('lets a team lead connect only their team without loading the organization', async () => {
    const other = { ...SUB, id: 's2', team: { id: 't9', key: 'ACC', name: 'Accounting' } };
    const calls = mockApi({
      'GET /api/integrations/slack': () => ({ json: [SUB, other] }),
      'POST /api/integrations/slack': () => ({ status: 201, json: SUB }),
    });
    await renderWithI18n(<IntegrationsSection team={{ id: 't1', name: 'Helpdesk' }} />);
    expect(await screen.findByText('#helpdesk')).toBeInTheDocument();
    expect(screen.queryByText(/Accounting/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Team' })).toHaveValue('t1');
    expect(calls.some((c) => c.path === '/api/admin/departments')).toBe(false);
  });
});
