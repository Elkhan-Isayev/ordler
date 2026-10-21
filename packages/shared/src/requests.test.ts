import { describe, expect, it } from 'vitest';
import {
  approvalDecisionSchema,
  formFieldsSchema,
  parseGroupIdentifier,
  parseRequestIdentifier,
  requestTypeInputSchema,
  validateFormData,
  type FormField,
} from './requests.js';

const FIELDS: FormField[] = [
  { id: 'item', label: 'Item', type: 'select', required: true, options: ['Headset', 'Laptop'] },
  { id: 'quantity', label: 'Quantity', type: 'number', required: true },
  { id: 'needed_by', label: 'Needed by', type: 'date', required: false },
  {
    id: 'extras',
    label: 'Extras',
    type: 'multi_select',
    required: false,
    options: ['Bag', 'Mouse'],
  },
  { id: 'urgent', label: 'Urgent', type: 'checkbox', required: false },
  { id: 'notes', label: 'Notes', type: 'long_text', required: false },
];

describe('validateFormData', () => {
  it('accepts valid answers and drops unknown keys', () => {
    const result = validateFormData(FIELDS, {
      item: 'Headset',
      quantity: '20',
      needed_by: '2026-11-01',
      extras: ['Bag', 'Bag'],
      urgent: true,
      notes: '  for CS  ',
      hacker: 'x',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        item: 'Headset',
        quantity: 20,
        needed_by: '2026-11-01',
        extras: ['Bag'],
        urgent: true,
        notes: 'for CS',
      },
    });
  });

  it('reports missing and invalid answers by field', () => {
    const result = validateFormData(FIELDS, {
      item: 'Yacht',
      needed_by: 'tomorrow',
      extras: ['Bag', 'Jet'],
      urgent: 'yes',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        item: 'invalid',
        quantity: 'required',
        needed_by: 'invalid',
        extras: 'invalid',
        urgent: 'invalid',
      },
    });
  });

  it('fills optional fields with empty values', () => {
    const result = validateFormData(FIELDS, { item: 'Laptop', quantity: 1 });
    expect(result.ok && result.data).toMatchObject({
      needed_by: null,
      extras: null,
      urgent: false,
    });
  });
});

describe('form definitions', () => {
  it('requires options for choice fields and unique ids', () => {
    expect(formFieldsSchema.safeParse([{ id: 'a', label: 'A', type: 'select' }]).success).toBe(
      false,
    );
    expect(
      formFieldsSchema.safeParse([
        { id: 'a', label: 'A', type: 'text' },
        { id: 'a', label: 'B', type: 'text' },
      ]).success,
    ).toBe(false);
    expect(formFieldsSchema.safeParse([{ id: 'Bad Id', label: 'A', type: 'text' }]).success).toBe(
      false,
    );
  });

  it('validates request types with approval steps', () => {
    const parsed = requestTypeInputSchema.parse({
      name: 'Hardware purchase',
      targetTeamId: '01a13d37-d040-7000-b257-000000000001',
      approvalSteps: [{ selector: { type: 'requester_department_supervisor' } }],
    });
    expect(parsed.approvalSteps[0]).toEqual({
      selector: { type: 'requester_department_supervisor' },
      rule: 'any',
    });
  });
});

describe('approvalDecisionSchema', () => {
  it('needs a comment to reject or request changes', () => {
    expect(approvalDecisionSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(approvalDecisionSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(
      approvalDecisionSchema.safeParse({ decision: 'request_changes', comment: ' ' }).success,
    ).toBe(false);
    expect(
      approvalDecisionSchema.safeParse({ decision: 'reject', comment: 'Too expensive' }).success,
    ).toBe(true);
  });
});

describe('identifiers', () => {
  it('parses request and group identifiers', () => {
    expect(parseRequestIdentifier('req-57')).toBe(57);
    expect(parseRequestIdentifier('REQ-G-3')).toBeUndefined();
    expect(parseGroupIdentifier('REQ-G-3')).toBe(3);
  });
});
