import type { FormField } from '@ordler/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { FormAnswers } from './common.js';

const FIELDS: FormField[] = [
  { id: 'item', label: 'Item', type: 'select', required: true, options: ['Laptop', 'Headset'] },
  {
    id: 'model',
    label: 'Model',
    type: 'text',
    required: true,
    visibleIf: { fieldId: 'item', op: 'in', values: ['Laptop'] },
  },
];

describe('FormAnswers', () => {
  it('leaves out fields the form hid from the requester', async () => {
    await renderWithI18n(<FormAnswers fields={FIELDS} values={{ item: 'Headset', model: null }} />);
    expect(screen.getByText('Headset')).toBeInTheDocument();
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
  });

  it('shows them when they applied', async () => {
    await renderWithI18n(<FormAnswers fields={FIELDS} values={{ item: 'Laptop', model: 'X1' }} />);
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('X1')).toBeInTheDocument();
  });
});
