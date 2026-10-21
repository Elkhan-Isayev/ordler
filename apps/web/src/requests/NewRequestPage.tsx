import {
  PRIORITIES,
  validateFormData,
  type ApprovalStepInput,
  type DirectoryView,
  type FormValue,
  type Priority,
  type RequestTypeView,
} from '@ordler/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { buttonClass, inputClass } from '../admin/common.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { selectClass } from '../issues/ui.js';
import { navigate } from '../router.js';
import { ApprovalStepsEditor, FormFields, namesFromDirectory, selectorLabel } from './common.js';

/**
 * Submits a request through one request type (/portals/new/:id), or one request to several
 * departments at once (/portals/group/:id,:id).
 */
export function NewRequestPage({ typeIds }: { typeIds: string[] }) {
  const { t } = useTranslation();
  const [types, setTypes] = useState<RequestTypeView[]>();
  const [directory, setDirectory] = useState<DirectoryView>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [values, setValues] = useState<Record<string, Record<string, FormValue>>>({});
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [extra, setExtra] = useState<ApprovalStepInput[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const isGroup = typeIds.length > 1;
  // A string, so a new array with the same ids does not reload the forms.
  const key = typeIds.join(',');

  useEffect(() => {
    Promise.all([Promise.all(key.split(',').map((id) => api.requestType(id))), api.directory()])
      .then(([loaded, dir]) => {
        setTypes(loaded);
        setDirectory(dir);
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [key]);

  if (!types || !directory) {
    return (
      <div className="p-8">
        {error ? (
          <FormError message={t(error)} />
        ) : (
          <p className="text-sm text-ink-muted">{t('auth.loading')}</p>
        )}
      </div>
    );
  }

  const canAddApprovals = types.every((type) => type.allowRequesterApprovals);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Same checks the server runs, so mistakes show next to the field right away.
    const nextErrors: Record<string, Record<string, string>> = {};
    for (const type of types!) {
      const result = validateFormData(type.fields, values[type.id] ?? {});
      if (!result.ok) nextErrors[type.id] = result.errors;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    setError(undefined);
    try {
      if (isGroup) {
        const group = await api.submitRequestGroup({
          title,
          description,
          priority,
          extraApprovals: extra,
          items: types!.map((type) => ({
            requestTypeId: type.id,
            formData: values[type.id] ?? {},
          })),
        });
        navigate(`/request-groups/${group.identifier}`);
      } else {
        const request = await api.submitRequest({
          requestTypeId: types![0]!.id,
          title,
          description,
          priority,
          extraApprovals: extra,
          formData: values[types![0]!.id] ?? {},
        });
        navigate(`/requests/${request.identifier}`);
      }
    } catch (failure) {
      setError(errorKey(failure));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t('requests.newTitle')}
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">
          {isGroup
            ? t('requests.newGroupTitle')
            : `${types[0]!.departmentName} · ${types[0]!.name}`}
        </h1>
        {!isGroup && types[0]!.description && (
          <p className="text-sm text-ink-muted">{types[0]!.description}</p>
        )}
        {isGroup && (
          <p className="text-sm text-ink-muted">
            {t('requests.groupTo', {
              departments: types.map((type) => type.departmentName).join(', '),
            })}
          </p>
        )}
      </header>

      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        {t('requests.title')}
        <input
          required
          maxLength={255}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={inputClass}
        />
      </label>
      <RichEditor
        value=""
        label={t('requests.description')}
        placeholder={t('requests.descriptionPlaceholder')}
        onChange={setDescription}
      />
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        {t('issues.priority.label')}
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
          className={selectClass}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(`issues.priority.${p}`)}
            </option>
          ))}
        </select>
      </label>

      {types.map((type) =>
        type.fields.length === 0 ? null : (
          <section
            key={type.id}
            aria-label={type.name}
            className="flex flex-col gap-2 rounded-lg border border-line p-4"
          >
            {isGroup && (
              <h2 className="text-sm font-semibold text-ink">
                {type.departmentName} · {type.name}
              </h2>
            )}
            <FormFields
              fields={type.fields}
              values={values[type.id] ?? {}}
              errors={errors[type.id]}
              onChange={(id, value) =>
                setValues((current) => ({
                  ...current,
                  [type.id]: { ...current[type.id], [id]: value },
                }))
              }
            />
          </section>
        ),
      )}

      {types.some((type) => type.approvalSteps.length > 0) && (
        <section
          aria-label={t('requests.requiredApprovals')}
          className="flex flex-col gap-1 text-sm"
        >
          <h2 className="text-xs font-medium text-ink-muted">{t('requests.requiredApprovals')}</h2>
          <ol className="list-decimal pl-5 text-ink">
            {types.flatMap((type) =>
              type.approvalSteps.map((step, i) => (
                <li key={`${type.id}-${i}`}>
                  {selectorLabel(t, step.selector, step.names)}
                  {isGroup && <span className="text-ink-faint"> · {type.departmentName}</span>}
                </li>
              )),
            )}
          </ol>
        </section>
      )}

      {canAddApprovals && (
        <ApprovalStepsEditor
          steps={extra}
          onChange={setExtra}
          directory={directory}
          label={isGroup ? t('requests.addGroupApprovals') : t('requests.addApprovals')}
        />
      )}
      {canAddApprovals && extra.length > 0 && (
        <p className="text-xs text-ink-faint">
          {extra
            .map((step) =>
              selectorLabel(t, step.selector, namesFromDirectory(step.selector, directory)),
            )
            .join(' → ')}
        </p>
      )}

      <FormError message={error ? t(error) : undefined} />
      <div>
        <button type="submit" disabled={busy || !title.trim()} className={buttonClass}>
          {t('requests.submit')}
        </button>
      </div>
    </form>
  );
}
