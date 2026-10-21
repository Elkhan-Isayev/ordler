import {
  FORM_FIELD_TYPES,
  type AdminDepartment,
  type ApprovalStepInput,
  type DirectoryView,
  type FormField,
  type FormFieldType,
  type RequestTypeInput,
  type RequestTypeView,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { ApprovalStepsEditor, selectorLabel } from '../requests/common.js';
import { buttonClass, ghostButtonClass, inputClass, Panel, SectionHeader } from './common.js';

/** A stable field id from its label; non-Latin labels fall back to field_N. */
export function fieldIdFor(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'f_$1')
      .slice(0, 30) || 'field';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}_${n}`;
  return id;
}

interface Draft {
  id?: string;
  input: RequestTypeInput;
}

const emptyDraft = (teamId: string): Draft => ({
  input: {
    name: '',
    description: '',
    category: null,
    fields: [],
    targetTeamId: teamId,
    approvalSteps: [],
    allowRequesterApprovals: false,
  },
});

/** Admin → Request types (SPEC §6.1): each department's portal offering and its approvals. */
export function RequestTypesSection() {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState<AdminDepartment[]>();
  const [directory, setDirectory] = useState<DirectoryView>();
  const [departmentId, setDepartmentId] = useState('');
  const [types, setTypes] = useState<RequestTypeView[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([api.departments(), api.directory()])
      .then(([list, dir]) => {
        const active = list.filter((d) => !d.archivedAt);
        setDepartments(active);
        setDirectory(dir);
        setDepartmentId(active[0]?.id ?? '');
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);

  const reload = useCallback(async () => {
    if (!departmentId) return;
    try {
      setTypes(await api.departmentRequestTypes(departmentId));
    } catch (failure) {
      setError(errorKey(failure));
    }
  }, [departmentId]);

  useEffect(() => {
    setDraft(undefined);
    void reload();
  }, [reload]);

  const department = departments?.find((d) => d.id === departmentId);
  const teams = department?.teams.filter((team) => !team.archivedAt) ?? [];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError(undefined);
    try {
      if (draft.id) await api.updateRequestType(draft.id, draft.input);
      else await api.createRequestType(departmentId, draft.input);
      setDraft(undefined);
      await reload();
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title={t('admin.requestTypes.title')}
        subtitle={t('admin.requestTypes.subtitle')}
      />
      <FormError message={error ? t(error) : undefined} />
      {departments && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('approvals.department')}
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className={selectClass}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {teams.length > 0 && !draft && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => setDraft(emptyDraft(teams[0]!.id))}
            >
              + {t('admin.requestTypes.new')}
            </button>
          )}
          {teams.length === 0 && (
            <span className="text-xs text-ink-faint">{t('admin.requestTypes.needsTeam')}</span>
          )}
        </div>
      )}

      {draft && directory && (
        <Panel>
          <form
            onSubmit={save}
            aria-label={t('admin.requestTypes.editor')}
            className="flex flex-col gap-3 text-sm"
          >
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('admin.requestTypes.name')}
              <input
                required
                maxLength={120}
                value={draft.input.name}
                onChange={(e) =>
                  setDraft({ ...draft, input: { ...draft.input, name: e.target.value } })
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('admin.requestTypes.description')}
              <input
                maxLength={2000}
                value={draft.input.description}
                onChange={(e) =>
                  setDraft({ ...draft, input: { ...draft.input, description: e.target.value } })
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('admin.requestTypes.targetTeam')}
              <select
                value={draft.input.targetTeamId}
                onChange={(e) =>
                  setDraft({ ...draft, input: { ...draft.input, targetTeamId: e.target.value } })
                }
                className={selectClass}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <FieldsEditor
              fields={draft.input.fields}
              onChange={(fields) => setDraft({ ...draft, input: { ...draft.input, fields } })}
            />
            <ApprovalStepsEditor
              steps={draft.input.approvalSteps}
              onChange={(approvalSteps: ApprovalStepInput[]) =>
                setDraft({ ...draft, input: { ...draft.input, approvalSteps } })
              }
              directory={directory}
              label={t('admin.requestTypes.mandatoryApprovals')}
            />
            <label className="flex items-center gap-2 text-ink-muted">
              <input
                type="checkbox"
                checked={draft.input.allowRequesterApprovals}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    input: { ...draft.input, allowRequesterApprovals: e.target.checked },
                  })
                }
              />
              {t('admin.requestTypes.allowRequesterApprovals')}
            </label>
            <div className="flex gap-2">
              <button type="submit" className={buttonClass}>
                {t('admin.auth.save')}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => setDraft(undefined)}
              >
                {t('issues.cancel')}
              </button>
            </div>
          </form>
        </Panel>
      )}

      {types.length === 0 && departmentId && !draft && (
        <p className="text-sm text-ink-muted">{t('admin.requestTypes.empty')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {types.map((type) => (
          <li key={type.id}>
            <Panel>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">{type.name}</span>
                <span className="text-xs text-ink-faint">→ {type.targetTeam.name}</span>
                {type.archivedAt && (
                  <span className="text-xs text-ink-faint">{t('admin.departments.archived')}</span>
                )}
                {!type.archivedAt && (
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className={ghostButtonClass}
                      onClick={() =>
                        setDraft({
                          id: type.id,
                          input: {
                            name: type.name,
                            description: type.description,
                            category: type.category,
                            fields: type.fields,
                            targetTeamId: type.targetTeam.id,
                            approvalSteps: type.approvalSteps.map(({ selector, rule }) => ({
                              selector,
                              rule,
                            })),
                            allowRequesterApprovals: type.allowRequesterApprovals,
                          },
                        })
                      }
                    >
                      {t('comments.edit')}
                    </button>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      onClick={async () => {
                        await api
                          .archiveRequestType(type.id)
                          .catch((f: unknown) => setError(errorKey(f)));
                        await reload();
                      }}
                    >
                      {t('admin.departments.archive')}
                    </button>
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                {t('admin.requestTypes.summary', { fields: type.fields.length })}
                {type.approvalSteps.length > 0 &&
                  ` · ${type.approvalSteps.map((s) => selectorLabel(t, s.selector, s.names)).join(' → ')}`}
              </p>
            </Panel>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FieldsEditor({
  fields,
  onChange,
}: {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
}) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<FormField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-xs font-medium text-ink-muted">
        {t('admin.requestTypes.fields')}
      </legend>
      {fields.map((field, index) => (
        <div
          key={field.id}
          role="group"
          aria-label={t('admin.requestTypes.fieldN', { n: index + 1 })}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            aria-label={t('admin.requestTypes.fieldLabel')}
            placeholder={t('admin.requestTypes.fieldLabel')}
            value={field.label}
            maxLength={120}
            onChange={(e) => update(index, { label: e.target.value })}
            className={`${inputClass} min-w-40 flex-1`}
          />
          <select
            aria-label={t('admin.requestTypes.fieldType')}
            value={field.type}
            onChange={(e) => update(index, { type: e.target.value as FormFieldType })}
            className={selectClass}
          >
            {FORM_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`admin.requestTypes.type.${type}`)}
              </option>
            ))}
          </select>
          {(field.type === 'select' || field.type === 'multi_select') && (
            <OptionsInput
              options={field.options ?? []}
              onChange={(options) => update(index, { options })}
            />
          )}
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => update(index, { required: e.target.checked })}
            />
            {t('admin.requestTypes.required')}
          </label>
          <button
            type="button"
            className={ghostButtonClass}
            aria-label={t('admin.requestTypes.removeField', { n: index + 1 })}
            onClick={() => onChange(fields.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className={ghostButtonClass}
          onClick={() =>
            onChange([
              ...fields,
              {
                id: fieldIdFor(
                  `field ${fields.length + 1}`,
                  fields.map((f) => f.id),
                ),
                label: '',
                type: 'text',
                required: false,
              },
            ])
          }
        >
          + {t('admin.requestTypes.addField')}
        </button>
      </div>
    </fieldset>
  );
}

/** Comma-separated options; the raw text is kept so typing a comma is not swallowed. */
function OptionsInput({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(options.join(', '));
  return (
    <input
      aria-label={t('admin.requestTypes.options')}
      placeholder={t('admin.requestTypes.options')}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean),
        );
      }}
      className={`${inputClass} min-w-40 flex-1`}
    />
  );
}
