import type { TeamView, UpdateIssueInput } from '@ordler/shared';
import { useTranslation } from 'react-i18next';

/** Project and, inside it, milestone of an issue; only projects that include the team. */
export function ProjectPicker({
  team,
  projectId,
  milestoneId,
  editable = true,
  className,
  onChange,
}: {
  team: TeamView;
  projectId: string | null;
  milestoneId: string | null;
  editable?: boolean;
  className: string;
  onChange: (patch: Pick<UpdateIssueInput, 'projectId' | 'milestoneId'>) => void;
}) {
  const { t } = useTranslation();
  const project = team.projects.find((p) => p.id === projectId);
  return (
    <span className="flex flex-col gap-1">
      <select
        value={projectId ?? ''}
        disabled={!editable}
        aria-label={t('projects.project')}
        className={className}
        onChange={(event) => onChange({ projectId: event.target.value || null, milestoneId: null })}
      >
        <option value="">{t('projects.noProject')}</option>
        {projectId && !project && <option value={projectId}>{t('projects.closedProject')}</option>}
        {team.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {project && project.milestones.length > 0 && (
        <select
          value={milestoneId ?? ''}
          disabled={!editable}
          aria-label={t('projects.milestone')}
          className={className}
          onChange={(event) => onChange({ milestoneId: event.target.value || null })}
        >
          <option value="">{t('projects.noMilestone')}</option>
          {project.milestones.map((m) => (
            <option key={m.id} value={m.id}>
              ◇ {m.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
