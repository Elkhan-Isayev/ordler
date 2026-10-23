import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { DueDatePicker } from './DueDatePicker.js';

describe('DueDatePicker', () => {
  it('reads "Due date" until a date is chosen', async () => {
    const onChange = vi.fn();
    await renderWithI18n(<DueDatePicker value={null} onChange={onChange} />, 'ru');
    expect(screen.getByText('Срок')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Убрать срок' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Срок'), { target: { value: '2026-11-03' } });
    expect(onChange).toHaveBeenCalledWith('2026-11-03');
  });

  it('shows the chosen date and clears it', async () => {
    const onChange = vi.fn();
    await renderWithI18n(<DueDatePicker value="2026-11-03" onChange={onChange} />);
    expect(screen.getByText('Nov 3, 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear due date' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('is read-only without edit rights', async () => {
    await renderWithI18n(<DueDatePicker value={null} editable={false} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
  });
});
