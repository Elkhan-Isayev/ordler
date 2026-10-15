import type { AdminDepartment } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, ghostButtonClass, inputClass, Panel, SectionHeader } from './common.js';

export function DepartmentsSection() {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState<AdminDepartment[]>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setDepartments(await api.departments());
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs an admin action, then refreshes; errors show at the top of the section. */
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

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('name')).trim();
    if (name && (await run(() => api.createDepartment(name)))) form.reset();
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title={t('admin.departments.title')}
        subtitle={t('admin.departments.subtitle')}
      />
      <FormError message={error} />
      <form
        onSubmit={createDepartment}
        aria-label={t('admin.departments.newDepartment')}
        className="flex gap-2"
      >
        <input
          name="name"
          required
          maxLength={120}
          aria-label={t('admin.departments.name')}
          placeholder={t('admin.departments.newDepartment')}
          className={`${inputClass} flex-1`}
        />
        <button type="submit" className={buttonClass}>
          {t('admin.departments.create')}
        </button>
      </form>

      {departments?.length === 0 && (
        <p className="text-sm text-ink-muted">{t('admin.departments.empty')}</p>
      )}
      {departments?.map((department) => (
        <DepartmentCard key={department.id} department={department} run={run} />
      ))}
    </section>
  );
}

function DepartmentCard({
  department,
  run,
}: {
  department: AdminDepartment;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const archived = department.archivedAt !== null;

  async function addTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await run(() =>
      api.createTeam(department.id, {
        name: String(data.get('name')).trim(),
        key: String(data.get('key')).trim().toUpperCase(),
        isPrivate: data.get('isPrivate') === 'on',
      }),
    );
    if (ok) form.reset();
  }

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-ink">
          {department.name}
          {archived && (
            <span className="ml-2 text-xs text-ink-faint">{t('admin.departments.archived')}</span>
          )}
        </h3>
        {!archived && (
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              if (
                window.confirm(t('admin.departments.confirmArchive', { name: department.name }))
              ) {
                void run(() => api.archiveDepartment(department.id));
              }
            }}
          >
            {t('admin.departments.archive')}
          </button>
        )}
      </div>

      {department.teams.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('admin.departments.noTeams')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {department.teams.map((team) => (
            <li key={team.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-xs text-ink-muted">
                  {team.key}
                </span>
                <span className="text-ink">{team.name}</span>
                {team.isPrivate && (
                  <span className="text-xs text-ink-faint">{t('admin.departments.private')}</span>
                )}
                {team.archivedAt && (
                  <span className="text-xs text-ink-faint">{t('admin.departments.archived')}</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-ink-faint">
                  {t('admin.departments.memberCount', { count: team.memberCount })}
                </span>
                {!team.archivedAt && (
                  <button
                    type="button"
                    className={ghostButtonClass}
                    onClick={() => {
                      if (
                        window.confirm(t('admin.departments.confirmArchive', { name: team.name }))
                      ) {
                        void run(() => api.archiveTeam(team.id));
                      }
                    }}
                  >
                    {t('admin.departments.archive')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!archived && (
        <form
          onSubmit={addTeam}
          aria-label={`${t('admin.departments.addTeam')}: ${department.name}`}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            name="name"
            required
            maxLength={120}
            aria-label={t('admin.departments.teamName')}
            placeholder={t('admin.departments.teamName')}
            className={`${inputClass} flex-1`}
          />
          <input
            name="key"
            required
            pattern="[A-Za-z][A-Za-z0-9]{1,9}"
            maxLength={10}
            aria-label={t('admin.departments.teamKey')}
            title={t('admin.departments.teamKeyHint')}
            placeholder="HELP"
            className={`${inputClass} w-24 font-mono uppercase`}
          />
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input type="checkbox" name="isPrivate" /> {t('admin.departments.private')}
          </label>
          <button type="submit" className={buttonClass}>
            {t('admin.departments.addTeam')}
          </button>
        </form>
      )}
    </Panel>
  );
}
