import {
  INITIATIVE_STATUSES,
  type InitiativeDetail,
  type InitiativeStatus,
  type InitiativeSummary,
  type ProjectSummary,
} from '@ordler/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { DueDatePicker } from '../issues/DueDatePicker.js';
import { Avatar, AvatarStack, quietSelectClass, selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';
import { HealthBadge, ProgressBar, StatusBadge } from './ProjectsPage.js';

function useDate() {
  const { i18n } = useTranslation();
  return (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
          new Date(`${value}T00:00:00Z`),
        )
      : '—';
}

/** Initiatives (/initiatives): objectives that group projects across the organization. */
export function InitiativesPage({ canCreate }: { canCreate: boolean }) {
  const { t } = useTranslation();
  const date = useDate();
  const [items, setItems] = useState<InitiativeSummary[]>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .initiatives()
      .then(setItems)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    try {
      const created = await api.createInitiative({ name });
      navigate(`/initiatives/${created.id}`);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('nav.initiatives')}</h1>
        {canCreate && (
          <button
            type="button"
            className={`${buttonClass} ml-auto flex items-center gap-1`}
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden size={14} />
            {t('initiatives.new')}
          </button>
        )}
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {creating && (
        <form
          aria-label={t('initiatives.new')}
          onSubmit={(event) => void create(event)}
          className="flex gap-2 border-b border-line px-4 py-3"
        >
          <input
            name="name"
            required
            autoFocus
            maxLength={120}
            aria-label={t('initiatives.name')}
            placeholder={t('initiatives.name')}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="submit" className={buttonClass}>
            {t('initiatives.create')}
          </button>
        </form>
      )}
      {items?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('initiatives.empty')}</p>
      )}
      <ul>
        {items?.map((item) => (
          <li key={item.id} className="border-b border-line">
            <Link
              href={`/initiatives/${item.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.name}</span>
              <HealthBadge health={item.health} />
              <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
                {t(`initiatives.status.${item.status}`)}
              </span>
              <span className="text-xs text-ink-faint">
                {t('initiatives.projectCount', { count: item.projectCount })}
              </span>
              <AvatarStack members={item.owner ? [item.owner] : []} />
              <span className="w-24 text-xs text-ink-faint">{date(item.targetDate)}</span>
              <ProgressBar progress={item.progress} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One initiative (/initiatives/:id): owner, target date, health roll-up and its projects. */
export function InitiativePage({ initiativeId }: { initiativeId: string }) {
  const { t } = useTranslation();
  const date = useDate();
  const [item, setItem] = useState<InitiativeDetail>();
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    api
      .initiative(initiativeId)
      .then(setItem)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [initiativeId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    void api
      .directory()
      .then((d) => setPeople(d.members))
      .catch(() => undefined);
    void api
      .projects()
      .then(setAllProjects)
      .catch(() => undefined);
  }, []);

  async function run(action: () => Promise<InitiativeDetail | void>) {
    try {
      const next = await action();
      if (next) setItem(next);
      setError(undefined);
      return true;
    } catch (failure) {
      setError(errorKey(failure));
      return false;
    }
  }

  if (!item) return <div className="p-8">{error && <FormError message={t(error)} />}</div>;
  const edit = item.can.edit;
  const save = (body: Parameters<typeof api.updateInitiative>[1]) =>
    void run(() => api.updateInitiative(item.id, body));
  const linked = item.projects.map((p) => p.id);
  const addable = allProjects.filter((p) => !linked.includes(p.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-ink-muted">
        <Link href="/initiatives" className="hover:text-ink">
          {t('nav.initiatives')}
        </Link>
        <span>/</span>
        <span className="text-ink">{item.name}</span>
        {edit && (
          <button
            type="button"
            className={`${ghostButtonClass} ml-auto`}
            onClick={() => {
              if (window.confirm(t('initiatives.confirmArchive', { name: item.name }))) {
                void run(() => api.archiveInitiative(item.id)).then(
                  (ok) => ok && navigate('/initiatives'),
                );
              }
            }}
          >
            {t('projects.archive')}
          </button>
        )}
      </header>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
        {error && <FormError message={t(error)} />}
        <input
          key={`name-${item.updatedAt}`}
          defaultValue={item.name}
          readOnly={!edit}
          aria-label={t('initiatives.name')}
          maxLength={120}
          className="bg-transparent text-2xl font-semibold tracking-tight text-ink outline-none"
          onBlur={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== item.name) save({ name });
          }}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-card p-4 text-sm shadow-card">
          <label className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.statusLabel')}
            <select
              value={item.status}
              disabled={!edit}
              className={quietSelectClass}
              onChange={(event) => save({ status: event.target.value as InitiativeStatus })}
            >
              {INITIATIVE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`initiatives.status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('initiatives.owner')}
            <span className="flex items-center gap-1">
              <Avatar member={item.owner} />
              <select
                value={item.owner?.id ?? ''}
                disabled={!edit}
                className={quietSelectClass}
                onChange={(event) => save({ ownerId: event.target.value || null })}
              >
                <option value="">{t('initiatives.noOwner')}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.targetDate')}
            <DueDatePicker
              value={item.targetDate}
              editable={edit}
              placeholder={t('projects.targetDate')}
              onChange={(targetDate) => save({ targetDate })}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.healthLabel')}
            <HealthBadge health={item.health} />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-faint">
            {t('projects.progress')}
            <ProgressBar progress={item.progress} />
          </div>
        </div>
        <RichEditor
          value={item.description}
          editable={edit}
          label={t('projects.description')}
          placeholder={t('initiatives.descriptionPlaceholder')}
          onCommit={(description) => save({ description })}
        />
        <section aria-label={t('nav.projects')} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">{t('nav.projects')}</h2>
          {item.projects.length === 0 && (
            <p className="text-sm text-ink-faint">{t('initiatives.noProjects')}</p>
          )}
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {item.projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
              >
                <Link
                  href={`/projects/${project.id}`}
                  className="min-w-0 flex-1 truncate text-ink hover:underline"
                >
                  {project.name}
                </Link>
                <HealthBadge health={project.health} />
                <StatusBadge status={project.status} />
                <span className="w-24 text-xs text-ink-faint">{date(project.targetDate)}</span>
                <ProgressBar progress={project.progress} />
                {edit && (
                  <button
                    type="button"
                    className={ghostButtonClass}
                    aria-label={t('initiatives.removeProject', { name: project.name })}
                    onClick={() =>
                      void run(() =>
                        api.setInitiativeProjects(
                          item.id,
                          linked.filter((id) => id !== project.id),
                        ),
                      )
                    }
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {edit && addable.length > 0 && (
            <select
              value=""
              aria-label={t('initiatives.addProject')}
              className={`${selectClass} w-fit`}
              onChange={(event) =>
                event.target.value &&
                void run(() => api.setInitiativeProjects(item.id, [...linked, event.target.value]))
              }
            >
              <option value="">{t('initiatives.addProject')}</option>
              {addable.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
        </section>
      </div>
    </div>
  );
}
