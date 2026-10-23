import type { MemberRef, TeamView } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { AvatarStack, quietSelectClass, selectClass } from './ui.js';

/**
 * One assignee as a select; several (when the team allows it) as checkboxes. Reports the full
 * list, so callers send `assigneeIds` for multi-assignee teams and `assigneeId` otherwise.
 */
export function AssigneePicker({
  team,
  value,
  editable,
  quiet = false,
  onChange,
}: {
  team: TeamView;
  value: MemberRef[];
  editable: boolean;
  /** Borderless, for the issue's properties panel. */
  quiet?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const ids = value.map((m) => m.id);
  if (!team.settings.multipleAssignees) {
    return (
      <select
        value={ids[0] ?? ''}
        disabled={!editable}
        aria-label={t('issues.assignee')}
        className={quiet ? quietSelectClass : selectClass}
        onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}
      >
        <option value="">{t('issues.noAssignee')}</option>
        {team.members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm text-ink">
        <AvatarStack members={value} />
        {value.length === 0 ? t('issues.noAssignee') : value.map((m) => m.name).join(', ')}
      </span>
      {editable && (
        <details>
          <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">
            {t('issues.assignees.edit')}
          </summary>
          <fieldset aria-label={t('issues.assignees.label')} className="mt-1 flex flex-col gap-1">
            {team.members.map((member) => (
              <label key={member.id} className="flex items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={ids.includes(member.id)}
                  onChange={() =>
                    onChange(
                      ids.includes(member.id)
                        ? ids.filter((id) => id !== member.id)
                        : [...ids, member.id],
                    )
                  }
                />
                {member.name}
              </label>
            ))}
          </fieldset>
        </details>
      )}
    </div>
  );
}

/** The update body for an assignee change, in the shape the team expects. */
export function assigneePatch(team: TeamView, ids: string[]) {
  return team.settings.multipleAssignees ? { assigneeIds: ids } : { assigneeId: ids[0] ?? null };
}
