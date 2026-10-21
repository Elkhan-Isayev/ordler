import { CUSTOM_ROLE_PERMISSIONS, type AdminRole } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import {
  buttonClass,
  ghostButtonClass,
  inputClass,
  Panel,
  roleLabel,
  SectionHeader,
} from './common.js';

/** Permission codes grouped by their area, e.g. `issue.read` under "issue". */
function groups(): Array<[string, string[]]> {
  const byArea = new Map<string, string[]>();
  for (const permission of CUSTOM_ROLE_PERMISSIONS) {
    const area = permission.split('.')[0]!;
    byArea.set(area, [...(byArea.get(area) ?? []), permission]);
  }
  return [...byArea.entries()];
}

function RoleForm({
  role,
  onSubmit,
  onCancel,
}: {
  role?: AdminRole;
  onSubmit: (name: string, permissions: string[]) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const permissions = CUSTOM_ROLE_PERMISSIONS.filter((p) => form.get(`perm:${p}`) === 'on');
    const ok = await onSubmit(String(form.get('name') ?? '').trim(), permissions);
    if (ok && !role) element.reset();
  }
  return (
    <form
      aria-label={
        role ? t('admin.customRoles.editNamed', { name: role.name }) : t('admin.customRoles.new')
      }
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        {t('admin.customRoles.name')}
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={role?.name}
          className={inputClass}
        />
      </label>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-1 text-xs text-ink-muted">
          {t('admin.customRoles.permissions')}
        </legend>
        {groups().map(([area, permissions]) => (
          <div key={area} className="flex flex-col gap-1">
            {permissions.map((permission) => (
              <label key={permission} className="flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  name={`perm:${permission}`}
                  defaultChecked={role?.permissions.includes(permission)}
                />
                <code>{permission}</code>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass}>
          {role ? t('admin.customRoles.save') : t('admin.customRoles.create')}
        </button>
        {onCancel && (
          <button type="button" className={ghostButtonClass} onClick={onCancel}>
            {t('admin.customRoles.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

/** Admin → Roles (SPEC §4.1): system roles read-only, custom roles from the permission catalog. */
export function RolesSection() {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<AdminRole[]>();
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setRoles(await api.roles());
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError(undefined);
    try {
      await action();
      await reload();
      return true;
    } catch (failure) {
      setError(t(errorKey(failure)));
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('admin.customRoles.title')}
        subtitle={t('admin.customRoles.subtitle')}
      />
      {error && <FormError message={error} />}
      <Panel>
        <ul className="flex flex-col divide-y divide-line">
          {roles?.map((role) => (
            <li key={role.id} className="flex flex-col gap-2 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-ink">{roleLabel(t, role)}</span>
                <span className="text-xs text-ink-faint">
                  {role.key ? t('admin.customRoles.system') : t('admin.customRoles.custom')} ·{' '}
                  {t('admin.customRoles.count', { count: role.permissions.length })}
                </span>
                {!role.key && (
                  <span className="ml-auto flex gap-1">
                    <button
                      type="button"
                      className={ghostButtonClass}
                      aria-label={t('admin.customRoles.editNamed', { name: role.name })}
                      onClick={() => setEditing(editing === role.id ? undefined : role.id)}
                    >
                      {t('admin.customRoles.edit')}
                    </button>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      aria-label={t('admin.customRoles.deleteNamed', { name: role.name })}
                      onClick={() => void run(() => api.deleteRole(role.id))}
                    >
                      {t('admin.customRoles.delete')}
                    </button>
                  </span>
                )}
              </div>
              {editing === role.id && (
                <RoleForm
                  role={role}
                  onCancel={() => setEditing(undefined)}
                  onSubmit={async (name, permissions) => {
                    const ok = await run(() => api.updateRole(role.id, { name, permissions }));
                    if (ok) setEditing(undefined);
                    return ok;
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('admin.customRoles.new')}</h3>
        <RoleForm
          onSubmit={(name, permissions) => run(() => api.createRole({ name, permissions }))}
        />
      </Panel>
    </div>
  );
}
