import {
  APPROVAL_TIMEOUT_ACTIONS,
  type ApprovalStepConfig,
  type ApprovalStepInput,
  type ApprovalTimeoutAction,
  type ApproverSelector,
  type DirectoryView,
  type FormField,
  type FormValue,
  type RequestStatus,
  type SelectorNames,
} from '@ordler/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ghostButtonClass, inputClass } from '../admin/common.js';
import { selectClass } from '../issues/ui.js';

const STATUS_STYLE: Record<RequestStatus, string> = {
  pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  changes_requested: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  open: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  in_progress: 'bg-accent/15 text-ink',
  waiting_for_requester: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  closed: 'bg-hover text-ink-muted',
  declined: 'bg-hover text-ink-muted',
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {t(`requests.status.${status}`)}
    </span>
  );
}

/** System roles are translated; custom roles keep their name. */
function roleName(t: TFunction, role: string | undefined): string {
  if (!role) return '—';
  return t(`admin.roles.${role}`, { defaultValue: role });
}

/** "Supervisor · Finance", "Head of IT", "Ann Lee", "Supervisor of the requester's department". */
export function selectorLabel(
  t: TFunction,
  selector: ApproverSelector,
  names: SelectorNames,
): string {
  switch (selector.type) {
    case 'user':
      return names.member ?? t('issues.someone');
    case 'role':
      return t('approvals.selector.role', {
        role: roleName(t, names.role),
        department: names.department ?? '—',
      });
    case 'department_head':
      return t('approvals.selector.department_head', { department: names.department ?? '—' });
    case 'requester_department_supervisor':
      return t('approvals.selector.requester_department_supervisor');
  }
}

/** Names for a selector the user is still editing, looked up in the directory. */
export function namesFromDirectory(
  selector: ApproverSelector,
  directory: DirectoryView,
): SelectorNames {
  const department = (id: string) => directory.departments.find((d) => d.id === id)?.name;
  switch (selector.type) {
    case 'user':
      return { member: directory.members.find((m) => m.id === selector.memberId)?.name ?? '' };
    case 'role': {
      const role = directory.roles.find((r) => r.id === selector.roleId);
      return {
        role: role?.key ?? role?.name ?? '',
        department: department(selector.departmentId) ?? '',
      };
    }
    case 'department_head':
      return { department: department(selector.departmentId) ?? '' };
    case 'requester_department_supervisor':
      return {};
  }
}

/** Inputs for a request type's form; values keyed by field id. */
export function FormFields({
  fields,
  values,
  errors = {},
  onChange,
  disabled = false,
}: {
  fields: FormField[];
  values: Record<string, FormValue>;
  errors?: Record<string, string>;
  onChange: (id: string, value: FormValue) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const value = values[field.id];
        const errorId = `field-${field.id}-error`;
        const described = errors[field.id]
          ? errorId
          : field.help
            ? `field-${field.id}-help`
            : undefined;
        const common = {
          id: `field-${field.id}`,
          disabled,
          'aria-invalid': errors[field.id] ? true : undefined,
          'aria-describedby': described,
        };
        return (
          <div key={field.id} className="flex flex-col gap-1 text-sm">
            {field.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  {...common}
                  checked={value === true}
                  onChange={(event) => onChange(field.id, event.target.checked)}
                />
                {field.label}
                {field.required && (
                  <span aria-hidden className="text-red-600">
                    *
                  </span>
                )}
              </label>
            ) : (
              <>
                <label htmlFor={common.id} className="text-xs font-medium text-ink-muted">
                  {field.label}
                  {field.required && (
                    <span aria-hidden className="text-red-600">
                      {' '}
                      *
                    </span>
                  )}
                </label>
                {field.type === 'long_text' ? (
                  <textarea
                    {...common}
                    rows={4}
                    required={field.required}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => onChange(field.id, event.target.value)}
                    className={inputClass}
                  />
                ) : field.type === 'select' ? (
                  <select
                    {...common}
                    required={field.required}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(event) => onChange(field.id, event.target.value || null)}
                    className={selectClass}
                  >
                    <option value="">{t('requests.choose')}</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'multi_select' ? (
                  <div role="group" aria-labelledby={common.id} className="flex flex-wrap gap-3">
                    {field.options?.map((option) => {
                      const list = Array.isArray(value) ? value : [];
                      return (
                        <label key={option} className="flex items-center gap-1 text-ink">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={list.includes(option)}
                            onChange={(event) =>
                              onChange(
                                field.id,
                                event.target.checked
                                  ? [...list, option]
                                  : list.filter((v) => v !== option),
                              )
                            }
                          />
                          {option}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    {...common}
                    type={
                      field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'
                    }
                    required={field.required}
                    value={
                      typeof value === 'string' || typeof value === 'number' ? String(value) : ''
                    }
                    onChange={(event) =>
                      onChange(
                        field.id,
                        field.type === 'number' && event.target.value !== ''
                          ? Number(event.target.value)
                          : event.target.value,
                      )
                    }
                    className={inputClass}
                  />
                )}
              </>
            )}
            {field.help && !errors[field.id] && (
              <span id={`field-${field.id}-help`} className="text-xs text-ink-faint">
                {field.help}
              </span>
            )}
            {errors[field.id] && (
              <span id={errorId} role="alert" className="text-xs text-red-600">
                {t(`requests.fieldError.${errors[field.id]}`)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Answers shown read-only on the request page. */
export function FormAnswers({
  fields,
  values,
}: {
  fields: FormField[];
  values: Record<string, FormValue>;
}) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  const show = (value: FormValue | undefined) =>
    value === null || value === undefined || value === ''
      ? '—'
      : Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'boolean'
          ? value
            ? t('requests.yes')
            : t('requests.no')
          : String(value);
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
      {fields.map((field) => (
        <div key={field.id} className="contents">
          <dt className="text-ink-muted">{field.label}</dt>
          <dd className="text-ink">{show(values[field.id])}</dd>
        </div>
      ))}
    </dl>
  );
}

const SELECTOR_TYPES: ApproverSelector['type'][] = [
  'requester_department_supervisor',
  'role',
  'department_head',
  'user',
];

/** Edits a list of approval steps; used by request type admins and by requesters. */
type EditableStep = ApprovalStepInput &
  Partial<Pick<ApprovalStepConfig, 'timeout' | 'fallbackSelector'>>;

/** The selector dropdowns of one approver choice: kind, then role, department or person. */
function SelectorFields({
  selector,
  onChange,
  directory,
  allowRequesterSupervisor,
  defaultSelector,
}: {
  selector: ApproverSelector;
  onChange: (selector: ApproverSelector) => void;
  directory: DirectoryView;
  allowRequesterSupervisor: boolean;
  defaultSelector: (type: ApproverSelector['type']) => ApproverSelector;
}) {
  const { t } = useTranslation();
  return (
    <>
      <select
        aria-label={t('approvals.approverType')}
        value={selector.type}
        onChange={(event) =>
          onChange(defaultSelector(event.target.value as ApproverSelector['type']))
        }
        className={selectClass}
      >
        {SELECTOR_TYPES.filter(
          (type) => allowRequesterSupervisor || type !== 'requester_department_supervisor',
        ).map((type) => (
          <option key={type} value={type}>
            {t(`approvals.type.${type}`)}
          </option>
        ))}
      </select>
      {selector.type === 'role' && (
        <select
          aria-label={t('approvals.role')}
          value={selector.roleId}
          onChange={(event) => onChange({ ...selector, roleId: event.target.value })}
          className={selectClass}
        >
          {directory.roles
            .filter((r) => r.key !== 'owner' && r.key !== 'guest' && r.key !== 'viewer')
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.key ? t(`admin.roles.${r.key}`, { defaultValue: r.name }) : r.name}
              </option>
            ))}
        </select>
      )}
      {(selector.type === 'role' || selector.type === 'department_head') && (
        <select
          aria-label={t('approvals.department')}
          value={selector.departmentId}
          onChange={(event) =>
            onChange({ ...selector, departmentId: event.target.value } as ApproverSelector)
          }
          className={selectClass}
        >
          {directory.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      {selector.type === 'user' && (
        <select
          aria-label={t('approvals.person')}
          value={selector.memberId}
          onChange={(event) => onChange({ type: 'user', memberId: event.target.value })}
          className={selectClass}
        >
          {directory.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

export function ApprovalStepsEditor<T extends EditableStep>({
  steps,
  onChange,
  directory,
  allowRequesterSupervisor = true,
  withTimeouts = false,
  label,
}: {
  steps: T[];
  onChange: (steps: T[]) => void;
  directory: DirectoryView;
  allowRequesterSupervisor?: boolean;
  /** Request types only: requesters cannot set timeouts on the steps they add. */
  withTimeouts?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  const supervisorRole = directory.roles.find((r) => r.key === 'department_supervisor');
  const firstDepartment = directory.departments[0]?.id ?? '';

  function defaultSelector(type: ApproverSelector['type']): ApproverSelector {
    switch (type) {
      case 'user':
        return { type, memberId: directory.members[0]?.id ?? '' };
      case 'role':
        return {
          type,
          roleId: supervisorRole?.id ?? directory.roles[0]?.id ?? '',
          departmentId: firstDepartment,
        };
      case 'department_head':
        return { type, departmentId: firstDepartment };
      case 'requester_department_supervisor':
        return { type };
    }
  }

  const update = (index: number, step: T) =>
    onChange(steps.map((s, i) => (i === index ? step : s)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-xs font-medium text-ink-muted">{label}</legend>
      {steps.map((step, index) => (
        <div
          key={index}
          role="group"
          aria-label={t('approvals.stepN', { n: index + 1 })}
          className="flex flex-col gap-1"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-faint">{index + 1}.</span>
            <SelectorFields
              selector={step.selector}
              onChange={(selector) => update(index, { ...step, selector })}
              directory={directory}
              allowRequesterSupervisor={allowRequesterSupervisor}
              defaultSelector={defaultSelector}
            />
            <select
              aria-label={t('approvals.rule')}
              value={step.rule}
              onChange={(event) =>
                update(index, { ...step, rule: event.target.value as ApprovalStepInput['rule'] })
              }
              className={selectClass}
            >
              <option value="any">{t('approvals.ruleAny')}</option>
              <option value="all">{t('approvals.ruleAll')}</option>
            </select>
            <button
              type="button"
              className={ghostButtonClass}
              aria-label={t('approvals.removeStep', { n: index + 1 })}
              onClick={() => onChange(steps.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
          {withTimeouts && (
            <div className="flex flex-wrap items-center gap-2 pl-5 text-xs text-ink-muted">
              <select
                aria-label={t('approvals.timeout.label')}
                value={step.timeout?.action ?? ''}
                onChange={(event) => {
                  const action = event.target.value as ApprovalTimeoutAction | '';
                  update(index, {
                    ...step,
                    timeout: action ? { hours: step.timeout?.hours ?? 24, action } : null,
                    fallbackSelector:
                      action === 'escalate' ? (step.fallbackSelector ?? null) : null,
                  });
                }}
                className={selectClass}
              >
                <option value="">{t('approvals.timeout.none')}</option>
                {APPROVAL_TIMEOUT_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {t(`approvals.timeout.${action}`)}
                  </option>
                ))}
              </select>
              {step.timeout && (
                <label className="flex items-center gap-1">
                  {t('approvals.timeout.after')}
                  <input
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={step.timeout.hours}
                    aria-label={t('approvals.timeout.hours')}
                    onChange={(event) =>
                      update(index, {
                        ...step,
                        timeout: { ...step.timeout!, hours: Number(event.target.value) },
                      })
                    }
                    className={`${selectClass} w-20`}
                  />
                  {t('approvals.timeout.businessHours')}
                </label>
              )}
              {step.timeout?.action === 'escalate' && (
                <span className="flex flex-wrap items-center gap-1">
                  {t('approvals.timeout.escalateTo')}
                  <select
                    aria-label={t('approvals.timeout.fallback')}
                    value={step.fallbackSelector ? 'custom' : ''}
                    onChange={(event) =>
                      update(index, {
                        ...step,
                        fallbackSelector: event.target.value ? defaultSelector('user') : null,
                      })
                    }
                    className={selectClass}
                  >
                    <option value="">{t('approvals.timeout.departmentAdmins')}</option>
                    <option value="custom">{t('approvals.timeout.chosen')}</option>
                  </select>
                  {step.fallbackSelector && (
                    <SelectorFields
                      selector={step.fallbackSelector}
                      onChange={(fallbackSelector) => update(index, { ...step, fallbackSelector })}
                      directory={directory}
                      allowRequesterSupervisor={allowRequesterSupervisor}
                      defaultSelector={defaultSelector}
                    />
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
      <div>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() =>
            onChange([
              ...steps,
              {
                selector: supervisorRole
                  ? { type: 'role', roleId: supervisorRole.id, departmentId: firstDepartment }
                  : defaultSelector('department_head'),
                rule: 'any',
                ...(withTimeouts ? { timeout: null, fallbackSelector: null } : {}),
              } as T,
            ])
          }
        >
          + {t('approvals.addStep')}
        </button>
      </div>
    </fieldset>
  );
}
