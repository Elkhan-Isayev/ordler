import { describe, expect, it } from 'vitest';
import {
  approvalDecisionSchema,
  conditionFits,
  formFieldsSchema,
  matchesCondition,
  conditionAnswers,
  routeRequest,
  visibleFieldIds,
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
      timeout: null,
      fallbackSelector: null,
      condition: null,
    });
    expect(parsed.routingRules).toEqual([]);
  });

  it('accepts step timeouts within bounds only', () => {
    const step = (timeout: object) =>
      requestTypeInputSchema.safeParse({
        name: 'Access',
        targetTeamId: '01a13d37-d040-7000-b257-000000000001',
        approvalSteps: [{ selector: { type: 'requester_department_supervisor' }, timeout }],
      }).success;
    expect(step({ hours: 8, action: 'escalate' })).toBe(true);
    expect(step({ hours: 0, action: 'remind' })).toBe(false);
    expect(step({ hours: 8, action: 'ignore' })).toBe(false);
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

const TEAM_A = '01a13d37-d040-7000-b257-0000000000aa';
const COND_FIELDS: FormField[] = [
  { id: 'item', label: 'Item', type: 'select', required: true, options: ['Laptop', 'Headset'] },
  { id: 'amount', label: 'Amount', type: 'number', required: false },
  {
    id: 'extras',
    label: 'Extras',
    type: 'multi_select',
    required: false,
    options: ['Bag', 'Mouse'],
  },
  { id: 'urgent', label: 'Urgent', type: 'checkbox', required: false },
];

describe('conditions', () => {
  it('compares choices, numbers, checkboxes and presence', () => {
    const data = { item: 'Laptop', amount: 1500, extras: ['Mouse'], urgent: true };
    expect(matchesCondition({ fieldId: 'item', op: 'in', values: ['Laptop'] }, data)).toBe(true);
    expect(matchesCondition({ fieldId: 'item', op: 'not_in', values: ['Laptop'] }, data)).toBe(
      false,
    );
    expect(matchesCondition({ fieldId: 'extras', op: 'in', values: ['Bag', 'Mouse'] }, data)).toBe(
      true,
    );
    expect(matchesCondition({ fieldId: 'amount', op: 'gt', value: 1000 }, data)).toBe(true);
    expect(matchesCondition({ fieldId: 'amount', op: 'lte', value: 1000 }, data)).toBe(false);
    expect(matchesCondition({ fieldId: 'urgent', op: 'checked' }, data)).toBe(true);
    expect(matchesCondition({ fieldId: 'amount', op: 'set' }, { amount: null })).toBe(false);
    // An unanswered number never satisfies a comparison.
    expect(matchesCondition({ fieldId: 'amount', op: 'lt', value: 10 }, { amount: null })).toBe(
      false,
    );
  });

  it('only fits fields with a matching type and options', () => {
    expect(conditionFits({ fieldId: 'item', op: 'in', values: ['Laptop'] }, COND_FIELDS)).toBe(
      true,
    );
    expect(conditionFits({ fieldId: 'item', op: 'in', values: ['Yacht'] }, COND_FIELDS)).toBe(
      false,
    );
    expect(conditionFits({ fieldId: 'item', op: 'gt', value: 1 }, COND_FIELDS)).toBe(false);
    expect(conditionFits({ fieldId: 'missing', op: 'set' }, COND_FIELDS)).toBe(false);
  });

  it('routes by the first matching rule, else to the default team', () => {
    const type = {
      targetTeamId: 'default',
      routingRules: [
        {
          condition: { fieldId: 'item', op: 'in' as const, values: ['Laptop'] },
          targetTeamId: 'infra',
        },
        { condition: { fieldId: 'amount', op: 'gt' as const, value: 0 }, targetTeamId: 'other' },
      ],
    };
    expect(routeRequest(type, { item: 'Laptop', amount: 5 })).toBe('infra');
    expect(routeRequest(type, { item: 'Headset', amount: 5 })).toBe('other');
    expect(routeRequest(type, { item: 'Headset', amount: null })).toBe('default');
  });
});

describe('conditional fields', () => {
  const fields: FormField[] = [
    COND_FIELDS[0]!,
    {
      id: 'model',
      label: 'Model',
      type: 'text',
      required: true,
      visibleIf: { fieldId: 'item', op: 'in', values: ['Laptop'] },
    },
    {
      id: 'charger',
      label: 'Charger',
      type: 'checkbox',
      required: false,
      visibleIf: { fieldId: 'model', op: 'set' },
    },
  ];

  it('requires a visible field', () => {
    expect(validateFormData(fields, { item: 'Laptop' })).toEqual({
      ok: false,
      errors: { model: 'required' },
    });
  });

  it('skips and clears hidden fields, including ones that depend on them', () => {
    expect(validateFormData(fields, { item: 'Headset', model: 'X1', charger: true })).toEqual({
      ok: true,
      data: { item: 'Headset', model: null, charger: false },
    });
  });

  it('tells the form which fields to show, reading raw number text', () => {
    expect([...visibleFieldIds(fields, { item: 'Laptop', model: 'X1' })]).toEqual([
      'item',
      'model',
      'charger',
    ]);
    expect([...visibleFieldIds(fields, { item: 'Headset', model: 'X1' })]).toEqual(['item']);
    const byAmount: FormField[] = [
      COND_FIELDS[1]!,
      { ...COND_FIELDS[3]!, visibleIf: { fieldId: 'amount', op: 'gt', value: 1000 } },
    ];
    expect(visibleFieldIds(byAmount, { amount: '1500' }).has('urgent')).toBe(true);
    expect(visibleFieldIds(byAmount, { amount: '' }).has('urgent')).toBe(false);
  });

  it('gives conditions the answers with hidden fields emptied', () => {
    expect(conditionAnswers(fields, { item: 'Headset', model: 'X1', charger: true }).data).toEqual({
      item: 'Headset',
      model: null,
      charger: null,
    });
  });

  it('accepts conditions on earlier fields only', () => {
    expect(formFieldsSchema.safeParse(fields).success).toBe(true);
    expect(formFieldsSchema.safeParse([...fields].reverse()).success).toBe(false);
  });

  it('rejects step and routing conditions that do not fit the form', () => {
    const base = { name: 'Laptop', targetTeamId: TEAM_A, fields: COND_FIELDS };
    expect(
      requestTypeInputSchema.safeParse({
        ...base,
        routingRules: [
          { condition: { fieldId: 'item', op: 'in', values: ['Laptop'] }, targetTeamId: TEAM_A },
        ],
        approvalSteps: [
          {
            selector: { type: 'requester_department_supervisor' },
            condition: { fieldId: 'amount', op: 'gt', value: 1000 },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      requestTypeInputSchema.safeParse({
        ...base,
        routingRules: [{ condition: { fieldId: 'nope', op: 'set' }, targetTeamId: TEAM_A }],
      }).success,
    ).toBe(false);
    expect(
      requestTypeInputSchema.safeParse({
        ...base,
        approvalSteps: [
          {
            selector: { type: 'requester_department_supervisor' },
            condition: { fieldId: 'urgent', op: 'gt', value: 1 },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
