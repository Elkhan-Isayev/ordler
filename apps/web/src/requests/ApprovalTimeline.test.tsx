import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { ApprovalTimeline } from './ApprovalTimeline.js';
import { step } from './fixtures.js';

const noop = () => Promise.resolve(true);

describe('ApprovalTimeline delegation and timeouts', () => {
  it('shows who decided for whom and that the viewer stands in', async () => {
    await renderWithI18n(
      <ApprovalTimeline
        onDecide={noop}
        steps={[
          step({
            canDecide: true,
            decidesFor: { id: 'm-boss', name: 'Cora Boss' },
            decisions: [
              {
                id: 'd1',
                approver: { id: 'm-dan', name: 'Dan Stand' },
                onBehalfOf: { id: 'm-eve', name: 'Eve Away' },
                decision: 'approve',
                comment: null,
                createdAt: '2026-11-02T10:00:00Z',
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText('for Eve Away')).toBeInTheDocument();
    expect(screen.getByText('You decide as the delegate of Cora Boss.')).toBeInTheDocument();
  });

  it('explains the timeout, and the escalation once it happened', async () => {
    const { unmount } = await renderWithI18n(
      <ApprovalTimeline
        onDecide={noop}
        steps={[step({ timeout: { hours: 8, action: 'escalate' } })]}
      />,
    );
    expect(screen.getByText('Escalates after 8 business hours')).toBeInTheDocument();
    unmount();
    await renderWithI18n(
      <ApprovalTimeline
        onDecide={noop}
        steps={[
          step({ timeout: { hours: 8, action: 'escalate' }, escalatedAt: '2026-11-02T17:00:00Z' }),
        ]}
      />,
    );
    expect(screen.getByText(/^Escalated/)).toBeInTheDocument();
    expect(screen.queryByText('Escalates after 8 business hours')).not.toBeInTheDocument();
  });
});
