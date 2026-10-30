import {
  PROJECT_STATUSES,
  type ProjectHealth,
  type ProjectProgress,
  type ProjectStatus,
  type ProjectSummary,
} from '@ordler/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { Timeline } from '../components/Timeline.js';
import { DueDatePicker } from '../issues/DueDatePicker.js';
import { AvatarStack, selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';

const HEALTH_COLOR: Record<ProjectHealth, string> = {
  on_track: '#30a46c',
  at_risk: '#d4a24c',
  off_track: '#e5484d',
};

/** Health as a dot plus its name: never colour alone. */
export function HealthBadge({ health }: { health: ProjectHealth | null }) {
  const { t } = useTranslation();
  if (!health) return <span className="text-xs text-ink-faint">{t('projects.noUpdates')}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: HEALTH_COLOR[health] }}
      />
      {t(`projects.health.${health}`)}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();
  return (
    <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
      {t(`projects.status.${status}`)}
    </span>
  );
}

export function ProgressBar({ progress }: { progress: ProjectProgress }) {
  const { t } = useTranslation();
  const percent =
    progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  return (
    <span
      className="flex min-w-32 items-center gap-2"
      title={t('projects.progressTitle', { ...progress })}
    >
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, background: 'var(--color-chart-done)' }}
        />
      </span>
      <span className="w-9 text-right text-xs text-ink-muted">{percent}%</span>
    </span>
  );
}

/** Projects across the workspace (/projects) or of one team (/teams/KEY/projects). */
export function ProjectsPage({ teamKey }: { teamKey?: string }) {
  const { t, i18n } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [timeline, setTimeline] = useState(
    () => new URLSearchParams(window.location.search).get('layout') === 'timeline',
  );

  function showTimeline(next: boolean) {
    setTimeline(next);
    // Kept in the address bar so the timeline can be shared or reloaded.
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next ? '?layout=timeline' : ''}`,
    );
  }

  const reload = useCallback(() => {
    api
      .projects(teamKey)
      .then(setProjects)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [teamKey]);
  useEffect(reload, [reload]);

  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
          new Date(`${value}T00:00:00Z`),
        )
      : '—';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">
          {teamKey ? `${teamKey} · ` : ''}
          {t('nav.projects')}
        </h1>
        <nav aria-label={t('issues.layout')} className="flex gap-1">
          {(
            [
              [false, t('issues.list')],
              [true, t('issues.timeline')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={timeline === value}
              onClick={() => showTimeline(value)}
              className={`rounded-md px-2 py-1 text-sm ${
                timeline === value
                  ? 'bg-hover text-ink'
                  : 'text-ink-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={`${buttonClass} ml-auto flex items-center gap-1`}
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden size={14} />
          {t('projects.new')}
        </button>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {projects?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('projects.empty')}</p>
      )}
      {timeline && projects && projects.length > 0 && (
        <Timeline
          label={t('issues.timeline')}
          items={projects
            .filter((project) => project.targetDate ?? project.startDate)
            .map((project) => ({
              id: project.id,
              href: `/projects/${project.id}`,
              label: project.name,
              start: project.targetDate ? project.startDate : null,
              end: (project.targetDate ?? project.startDate)!,
              done: project.status === 'completed' || project.status === 'canceled',
              title: `${date(project.startDate)} – ${date(project.targetDate)}`,
            }))}
        />
      )}
      {timeline && projects?.some((project) => !project.targetDate && !project.startDate) && (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
          {t('timeline.undatedProjects', {
            count: projects.filter((project) => !project.targetDate && !project.startDate).length,
          })}
        </p>
      )}
      <ul hidden={timeline}>
        {projects?.map((project) => (
          <li key={project.id} className="border-b border-line">
            <Link
              href={`/projects/${project.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{project.name}</span>
              <HealthBadge health={project.health} />
              <StatusBadge status={project.status} />
              <span className="text-xs text-ink-faint">
                {project.teams.map((team) => team.key).join(', ')}
              </span>
              <AvatarStack members={project.lead ? [project.lead] : []} />
              <span className="w-24 text-xs text-ink-faint">{date(project.targetDate)}</span>
              <ProgressBar progress={project.progress} />
            </Link>
          </li>
        ))}
      </ul>
      {creating && (
        <NewProjectDialog
          defaultTeamKey={teamKey}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/projects/${id}`)}
        />
      )}
    </div>
  );
}

function NewProjectDialog({
  defaultTeamKey,
  onClose,
  onCreated,
}: {
  defaultTeamKey?: string | undefined;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<
    Array<{ id: string; key: string; name: string; department: string }>
  >([]);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.all([api.readableTeams(), api.directory()]).then(([teamList, directory]) => {
      setTeams(teamList);
      setPeople(directory.members);
      const preset = teamList.find((team) => team.key === defaultTeamKey);
      if (preset) setTeamIds([preset.id]);
    });
  }, [defaultTeamKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const leadId = String(form.get('leadId') ?? '');
    setError(undefined);
    try {
      const created = await api.createProject({
        name: String(form.get('name') ?? '').trim(),
        status: String(form.get('status')) as ProjectStatus,
        teamIds,
        leadId: leadId || null,
        memberIds: leadId ? [leadId] : [],
        targetDate,
      });
      onCreated(created.id);
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t('projects.new')}
        onSubmit={(event) => void submit(event)}
        className="flex w-full max-w-xl flex-col gap-4 rounded-xl border border-line bg-card p-5 shadow-2xl"
      >
        <input
          name="name"
          required
          maxLength={120}
          autoFocus
          aria-label={t('projects.name')}
          placeholder={t('projects.name')}
          className="bg-transparent text-xl font-semibold text-ink outline-none placeholder:text-ink-faint"
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-ink-muted">{t('projects.teams')}</legend>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {teams.map((team) => (
              <label
                key={team.id}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  checked={teamIds.includes(team.id)}
                  onChange={() =>
                    setTeamIds((ids) =>
                      ids.includes(team.id)
                        ? ids.filter((id) => id !== team.id)
                        : [...ids, team.id],
                    )
                  }
                />
                {team.department} / {team.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('projects.statusLabel')}
            <select name="status" defaultValue="planned" className={selectClass}>
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`projects.status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('projects.lead')}
            <select name="leadId" defaultValue="" className={selectClass}>
              <option value="">{t('projects.noLead')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('projects.targetDate')}
            <DueDatePicker
              value={targetDate}
              placeholder={t('projects.targetDate')}
              onChange={setTargetDate}
            />
          </div>
        </div>
        {error && <FormError message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            {t('issues.cancel')}
          </button>
          <button type="submit" className={buttonClass} disabled={teamIds.length === 0}>
            {t('projects.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
