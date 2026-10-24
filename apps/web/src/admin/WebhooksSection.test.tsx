import type { WebhookDeliveryView, WebhookView } from '@ordler/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { DEPARTMENTS } from './fixtures.js';
import { WebhooksSection } from './WebhooksSection.js';

afterEach(() => vi.unstubAllGlobals());

const HOOK: WebhookView = {
  id: 'w1',
  name: 'CI bridge',
  url: 'https://ci.example.test/hook',
  events: ['issue.created'],
  scope: { type: 'organization' },
  enabled: true,
  recentFailures: 2,
  lastDeliveryAt: null,
  createdAt: '2026-10-25T09:00:00Z',
};

const DELIVERY: WebhookDeliveryView = {
  id: 'd1',
  event: 'issue.created',
  status: 'failed',
  attempts: 8,
  responseStatus: 500,
  error: 'HTTP 500',
  nextAttemptAt: null,
  createdAt: '2026-10-25T09:00:00Z',
  deliveredAt: null,
  payload: {},
};

describe('WebhooksSection', () => {
  it('creates a webhook and shows its secret once', async () => {
    let hooks: WebhookView[] = [];
    const calls = mockApi({
      'GET /api/admin/webhooks': () => ({ json: hooks }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'POST /api/admin/webhooks': () => {
        hooks = [HOOK];
        return { status: 201, json: { webhook: HOOK, secret: 'whsec_test_secret' } };
      },
    });
    await renderWithI18n(<WebhooksSection />);
    expect(await screen.findByText('No webhooks yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'CI bridge');
    await userEvent.type(screen.getByLabelText('Endpoint URL'), 'https://ci.example.test/hook');
    await userEvent.click(screen.getByRole('checkbox', { name: /Issue changed/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Approval decided/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
    expect(await screen.findByText('whsec_test_secret')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'CI bridge',
      url: 'https://ci.example.test/hook',
      events: ['issue.created', 'approval.decided'],
      scope: { type: 'organization' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('whsec_test_secret')).not.toBeInTheDocument();
    expect(
      await screen.findByText('2 failed deliveries this week', { exact: false }),
    ).toBeInTheDocument();
  });

  it('shows the delivery log, redelivers and pauses', async () => {
    const calls = mockApi({
      'GET /api/admin/webhooks': () => ({ json: [HOOK] }),
      'GET /api/admin/departments': () => ({ json: DEPARTMENTS }),
      'GET /api/admin/webhooks/w1/deliveries': () => ({ json: [DELIVERY] }),
      'POST /api/admin/webhooks/deliveries/d1/redeliver': () => ({
        status: 201,
        json: { ...DELIVERY, id: 'd2', status: 'pending' },
      }),
      'PATCH /api/admin/webhooks/w1': () => ({ json: { ...HOOK, enabled: false } }),
    });
    await renderWithI18n(<WebhooksSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delivery log' }));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/8 attempts/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/api/admin/webhooks/deliveries/d1/redeliver')).toBe(
        true,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: false }),
    );
  });
});
