import {
  conditionFits,
  conditionOpsFor,
  type ConditionOp,
  type FieldCondition,
  type FormField,
  type RequestTypeInput,
} from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { selectClass } from '../issues/ui.js';

/** A fresh condition for a field: its first operator, and its first option where one is needed. */
export function defaultCondition(field: FormField): FieldCondition {
  return conditionFor(field, conditionOpsFor(field.type)[0]!);
}

function conditionFor(
  field: FormField,
  op: ConditionOp,
  previous?: FieldCondition,
): FieldCondition {
  if (op === 'in' || op === 'not_in') {
    const values = previous && 'values' in previous ? previous.values : [field.options?.[0] ?? ''];
    return { fieldId: field.id, op, values };
  }
  if (op === 'eq' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    return { fieldId: field.id, op, value: previous && 'value' in previous ? previous.value : 0 };
  }
  return { fieldId: field.id, op };
}

/**
 * Drops conditions that no longer fit after the form changed (a field removed, retyped or an
 * option renamed), so a stale rule never blocks saving or silently matches nothing.
 */
export function pruneConditions(input: RequestTypeInput): RequestTypeInput {
  const fields = input.fields.map((field, index) =>
    field.visibleIf && !conditionFits(field.visibleIf, input.fields.slice(0, index))
      ? { ...field, visibleIf: undefined }
      : field,
  );
  return {
    ...input,
    fields,
    routingRules: input.routingRules.filter((rule) => conditionFits(rule.condition, fields)),
    approvalSteps: input.approvalSteps.map((step) =>
      step.condition && !conditionFits(step.condition, fields)
        ? { ...step, condition: null }
        : step,
    ),
  };
}

/**
 * One condition: field, operator and value (SPEC §6.1, §6.3). With `noneLabel` the first
 * choice means "no condition"; without it a condition is required (routing rules).
 */
export function ConditionEditor({
  fields,
  value,
  onChange,
  label,
  noneLabel,
  prefix,
}: {
  fields: FormField[];
  value: FieldCondition | null | undefined;
  onChange: (condition: FieldCondition | null) => void;
  label: string;
  noneLabel?: string;
  /** Read before a set condition, e.g. "Show if"; the none choice speaks for itself. */
  prefix?: string;
}) {
  const { t } = useTranslation();
  const field = value ? fields.find((f) => f.id === value.fieldId) : undefined;

  return (
    <span role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      {prefix && field && <span className="text-xs text-ink-muted">{prefix}</span>}
      <select
        aria-label={t('conditions.field')}
        value={field?.id ?? ''}
        onChange={(event) => {
          const next = fields.find((f) => f.id === event.target.value);
          onChange(next ? defaultCondition(next) : null);
        }}
        className={selectClass}
      >
        {noneLabel !== undefined && <option value="">{noneLabel}</option>}
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label || f.id}
          </option>
        ))}
      </select>
      {field && value && (
        <>
          <select
            aria-label={t('conditions.operator')}
            value={value.op}
            onChange={(event) =>
              onChange(conditionFor(field, event.target.value as ConditionOp, value))
            }
            className={selectClass}
          >
            {conditionOpsFor(field.type).map((op) => (
              <option key={op} value={op}>
                {t(`conditions.op.${op}`)}
              </option>
            ))}
          </select>
          {'values' in value && (
            <span className="flex flex-wrap items-center gap-2">
              {(field.options ?? []).map((option) => (
                <label key={option} className="flex items-center gap-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={value.values.includes(option)}
                    onChange={(event) => {
                      const values = event.target.checked
                        ? [...value.values, option]
                        : value.values.filter((v) => v !== option);
                      // At least one option stays chosen; an empty list means nothing.
                      if (values.length > 0) onChange({ ...value, values });
                    }}
                  />
                  {option}
                </label>
              ))}
            </span>
          )}
          {'value' in value && (
            <input
              type="number"
              aria-label={t('conditions.value')}
              value={Number.isFinite(value.value) ? value.value : ''}
              onChange={(event) => onChange({ ...value, value: Number(event.target.value) })}
              className={`${selectClass} w-24`}
            />
          )}
        </>
      )}
    </span>
  );
}
