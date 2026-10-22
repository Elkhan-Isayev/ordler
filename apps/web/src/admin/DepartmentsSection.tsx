import type { AdminDepartment } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { buttonClass, ghostButtonClass, inputClass, Panel, SectionHeader } from './common.js';

export function DepartmentsSection() {
  const { t } = useTranslation();
  const [departments, setDepartments] = useState<AdminDepartment[]>();
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // Only for choosing department heads; the section works without it.
    api
      .members()
      .then((list) => setPeople(list.filter((m) => m.status === 'active')))
      .catch(() => undefined);
  }, []);

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
        <DepartmentCard key={department.id} department={department} people={people} run={run} />
      ))}
    </section>
  );
}

function DepartmentCard({
  department,
  people,
  run,
}: {
  department: AdminDepartment;
  people: Array<{ id: string; name: string }>;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const archived = department.archivedAt !== null;

  const [key, setKey] = useState('');

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
    if (ok) {
      form.reset();
      setKey('');
    }
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
        {!archived && people.length > 0 && (
          <label className="ml-auto flex items-center gap-1 text-xs text-ink-muted">
            {t('admin.departments.head')}
            <select
              value={department.headMemberId ?? ''}
              onChange={(event) =>
                void run(() =>
                  api.updateDepartment(department.id, { headMemberId: event.target.value || null }),
                )
              }
              className={inputClass}
            >
              <option value="">—</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
                {team.archivedAt ? (
                  <span className="text-ink">{team.name}</span>
                ) : (
                  <Link href={`/teams/${team.key}/board`} className="text-ink hover:underline">
                    {team.name}
                  </Link>
                )}
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
                  <label className="flex items-center gap-1 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={team.multipleAssignees}
                      aria-label={t('admin.departments.multipleAssigneesFor', { name: team.name })}
                      onChange={(event) =>
                        void run(() =>
                          api.updateTeam(team.id, { multipleAssignees: event.target.checked }),
                        )
                      }
                    />
                    {t('admin.departments.multipleAssignees')}
                  </label>
                )}
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
          className="flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
            {t('admin.departments.teamName')}
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Platform"
              className={inputClass}
            />
          </label>
          <label className="flex w-32 flex-col gap-1 text-xs text-ink-muted">
            {t('admin.departments.teamKey')}
            <input
              name="key"
              required
              pattern="[A-Za-z][A-Za-z0-9]{1,9}"
              maxLength={10}
              title={t('admin.departments.teamKeyHint')}
              placeholder="PLAT"
              value={key}
              onChange={(event) => setKey(event.target.value.toUpperCase())}
              className={`${inputClass} font-mono uppercase`}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input type="checkbox" name="isPrivate" /> {t('admin.departments.private')}
          </label>
          <button type="submit" className={buttonClass}>
            {t('admin.departments.addTeam')}
          </button>
          {/* Shows what the key is for before the team exists. */}
          <p className="w-full text-xs text-ink-faint">
            {t('admin.departments.teamKeyPreview', { key: key || 'PLAT' })}
          </p>
        </form>
      )}
    </Panel>
  );
}
