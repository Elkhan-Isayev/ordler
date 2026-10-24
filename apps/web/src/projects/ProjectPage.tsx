import {
  PROJECT_HEALTH,
  PROJECT_STATUSES,
  type ProjectDetail,
  type ProjectHealth,
  type ProjectStatus,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { RichEditor } from '../editor/RichEditor.js';
import { formatWhen } from '../issues/Comments.js';
import { DueDatePicker } from '../issues/DueDatePicker.js';
import { IssueList } from '../issues/IssueList.js';
import { Avatar, quietSelectClass, selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';
import { HealthBadge, ProgressBar } from './ProjectsPage.js';

/** One project (/projects/:id): properties, milestones, status updates and its issues. */
export function ProjectPage({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const [project, setProject] = useState<ProjectDetail>();
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    api
      .project(projectId)
      .then(setProject)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [projectId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    void api
      .directory()
      .then((directory) => setPeople(directory.members))
      .catch(() => undefined);
  }, []);

  async function run(action: () => Promise<ProjectDetail | void>) {
    try {
      const next = await action();
      if (next) setProject(next);
      setError(undefined);
      return true;
    } catch (failure) {
      setError(errorKey(failure));
      return false;
    }
  }

  if (!project) return <div className="p-8">{error && <FormError message={t(error)} />}</div>;
  const edit = project.can.edit;
  const save = (body: Parameters<typeof api.updateProject>[1]) =>
    void run(() => api.updateProject(project.id, body));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-ink-muted">
        <Link href="/projects" className="hover:text-ink">
          {t('nav.projects')}
        </Link>
        <span>/</span>
        <span className="text-ink">{project.name}</span>
        {edit && (
          <button
            type="button"
            className={`${ghostButtonClass} ml-auto`}
            onClick={() => {
              if (window.confirm(t('projects.confirmArchive', { name: project.name }))) {
                void run(() => api.archiveProject(project.id)).then(
                  (ok) => ok && navigate('/projects'),
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
          key={`name-${project.updatedAt}`}
          defaultValue={project.name}
          readOnly={!edit}
          aria-label={t('projects.name')}
          maxLength={120}
          className="bg-transparent text-2xl font-semibold tracking-tight text-ink outline-none"
          onBlur={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== project.name) save({ name });
          }}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-card p-4 text-sm shadow-card">
          <label className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.statusLabel')}
            <select
              value={project.status}
              disabled={!edit}
              className={quietSelectClass}
              onChange={(event) => save({ status: event.target.value as ProjectStatus })}
            >
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`projects.status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.lead')}
            <span className="flex items-center gap-1">
              <Avatar member={project.lead} />
              <select
                value={project.lead?.id ?? ''}
                disabled={!edit}
                className={quietSelectClass}
                onChange={(event) => save({ leadId: event.target.value || null })}
              >
                <option value="">{t('projects.noLead')}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.startDate')}
            <DueDatePicker
              value={project.startDate}
              placeholder={t('projects.startDate')}
              editable={edit}
              onChange={(startDate) => save({ startDate })}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.targetDate')}
            <DueDatePicker
              value={project.targetDate}
              placeholder={t('projects.targetDate')}
              editable={edit}
              onChange={(targetDate) => save({ targetDate })}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-ink-faint">
            {t('projects.teams')}
            <span className="text-sm text-ink">
              {project.teams.map((team) => team.name).join(', ')}
            </span>
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-faint">
            {t('projects.progress')}
            <ProgressBar progress={project.progress} />
          </div>
        </div>
        <RichEditor
          value={project.description}
          editable={edit}
          label={t('projects.description')}
          placeholder={t('projects.descriptionPlaceholder')}
          onCommit={(description) => save({ description })}
        />
        <Milestones project={project} onChange={(next) => setProject(next)} onError={setError} />
        <Updates
          project={project}
          onChange={(next) => setProject(next)}
          onError={setError}
          language={i18n.language}
        />
      </div>
      <section aria-label={t('projects.issues')} className="border-t border-line">
        <h2 className="px-4 py-3 text-sm font-semibold text-ink">
          {t('projects.issues')}{' '}
          <span className="font-normal text-ink-faint">{project.issues.length}</span>
        </h2>
        <IssueList issues={project.issues} showTeam />
      </section>
    </div>
  );
}

function Milestones({
  project,
  onChange,
  onError,
}: {
  project: ProjectDetail;
  onChange: (next: ProjectDetail) => void;
  onError: (code: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      onChange(await api.addMilestone(project.id, { name: name.trim(), targetDate: null }));
      setName('');
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  return (
    <section aria-label={t('projects.milestones')} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">{t('projects.milestones')}</h2>
      {project.milestones.length === 0 && (
        <p className="text-sm text-ink-faint">{t('projects.noMilestones')}</p>
      )}
      <ul className="flex flex-col gap-1">
        {project.milestones.map((milestone) => (
          <li
            key={milestone.id}
            className="flex items-center gap-3 rounded-lg px-2 py-1 text-sm hover:bg-hover"
          >
            <span aria-hidden className="size-2 rotate-45 border border-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-ink">{milestone.name}</span>
            <ProgressBar progress={milestone.progress} />
            {project.can.edit && (
              <button
                type="button"
                className={ghostButtonClass}
                aria-label={t('projects.removeMilestone', { name: milestone.name })}
                onClick={() =>
                  void api
                    .removeMilestone(milestone.id)
                    .then(onChange)
                    .catch((failure: unknown) => onError(errorKey(failure)))
                }
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {project.can.edit && (
        <form onSubmit={(event) => void add(event)}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            aria-label={t('projects.addMilestone')}
            placeholder={t('projects.addMilestone')}
            className={`${inputClass} w-full`}
          />
        </form>
      )}
    </section>
  );
}

function Updates({
  project,
  onChange,
  onError,
  language,
}: {
  project: ProjectDetail;
  onChange: (next: ProjectDetail) => void;
  onError: (code: string) => void;
  language: string;
}) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<ProjectHealth>('on_track');
  const [body, setBody] = useState('');

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      onChange(await api.postProjectUpdate(project.id, { health, body: body.trim() }));
      setBody('');
    } catch (failure) {
      onError(errorKey(failure));
    }
  }

  return (
    <section aria-label={t('projects.updates')} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink">{t('projects.updates')}</h2>
      {project.can.post && (
        <form
          onSubmit={(event) => void post(event)}
          className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3 shadow-card"
        >
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={20_000}
            aria-label={t('projects.updateBody')}
            placeholder={t('projects.updatePlaceholder')}
            className="resize-y bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center gap-2">
            <select
              value={health}
              aria-label={t('projects.healthLabel')}
              className={selectClass}
              onChange={(event) => setHealth(event.target.value as ProjectHealth)}
            >
              {PROJECT_HEALTH.map((value) => (
                <option key={value} value={value}>
                  {t(`projects.health.${value}`)}
                </option>
              ))}
            </select>
            <button type="submit" className={`${buttonClass} ml-auto`} disabled={!body.trim()}>
              {t('projects.postUpdate')}
            </button>
          </div>
        </form>
      )}
      {project.updates.length === 0 && (
        <p className="text-sm text-ink-faint">{t('projects.noUpdates')}</p>
      )}
      <ol className="flex flex-col gap-3">
        {project.updates.map((update) => (
          <li key={update.id} className="flex flex-col gap-1 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Avatar member={update.author} />
              <span className="text-ink">{update.author?.name}</span>
              <HealthBadge health={update.health} />
              <span className="ml-auto text-ink-faint">
                {formatWhen(update.createdAt, language)}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap text-ink">{update.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
