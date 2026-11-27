import { render, screen } from '@testing-library/react';
import { renderWithI18n } from '../test/render.js';
import { describe, expect, it } from 'vitest';
import { Avatar, LabelChip, LabelChips } from './ui.js';

describe('Avatar', () => {
  it.each([
    ['Ann Lee', 'AL'],
    ['Алия (CS)', 'АC'],
    ['(admin) Bob', 'AB'],
    ['Owner', 'O'],
  ])('shows initials of %s', (name, initials) => {
    render(<Avatar member={{ id: 'm', name }} />);
    expect(screen.getByTitle(name)).toHaveTextContent(initials);
  });
});

describe('LabelChip', () => {
  it('names the label in its tooltip, since a long name is cut with an ellipsis', () => {
    render(<LabelChip label={{ name: 'customer-escalation', color: '#e5484d' }} />);
    expect(screen.getByTitle('customer-escalation')).toHaveClass('whitespace-nowrap', 'shrink-0');
  });
});

describe('LabelChips', () => {
  const labels = ['a', 'b', 'c'].map((name) => ({ id: name, name, color: '#e5484d' }));

  it('shows all labels when they fit under the limit', async () => {
    await renderWithI18n(<LabelChips labels={labels} max={3} />);
    expect(screen.getByText('c')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('counts the hidden labels in every locale', async () => {
    await renderWithI18n(<LabelChips labels={labels} max={1} />, 'ru');
    expect(screen.getByLabelText('ещё 2 метки')).toHaveTextContent('+2');
  });
});
