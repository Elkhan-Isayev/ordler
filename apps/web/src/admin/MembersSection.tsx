import type { AdminDepartment, AdminMember, AdminRole, InviteResponse } from '@ordler/shared';
import { copyText } from '../components/clipboard.js';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
  scopeLabel,
  scopeOptions,
  SectionHeader,
} from './common.js';

interface Data {
  members: AdminMember[];
  roles: AdminRole[];
  departments: AdminDepartment[];
}

export function MembersSection({ currentMemberId }: { currentMemberId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();
  const [invite, setInvite] = useState<{ email: string; url: string; emailed: boolean }>();

  const reload = useCallback(async () => {
    try {
      const [members, roles, departments] = await Promise.all([
        api.members(),
        api.roles(),
        api.departments(),
      ]);
      setData({ members, roles, departments });
    } catch (failure) {
      setError(t(errorKey(failure)));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError(undefined);
    try {
      const result = await action();
      await reload();
      return result;
    } catch (failure) {
      setError(t(errorKey(failure)));
      return undefined;
    }
  }

  const options = useMemo(() => (data ? scopeOptions(t, data.departments) : []), [data, t]);

  async function sendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get('email')).trim();
    const roleId = String(values.get('roleId'));
    const scope = options.find((o) => o.value === values.get('scope'))?.scope;
    const result = await run<InviteResponse>(() =>
      api.inviteMember({
        email,
        name: String(values.get('name')).trim(),
        ...(roleId && scope ? { role: { roleId, scope } } : {}),
        // A role on a team implies working in it, so the team shows up in their sidebar.
        ...(roleId && scope?.type === 'team' ? { teamIds: [scope.id] } : {}),
      }),
    );
    if (result) {
      setInvite({ email: result.member.email, url: result.inviteUrl, emailed: result.emailed });
      form.reset();
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.members.title')} subtitle={t('admin.members.subtitle')} />
      <FormError message={error} />

      <Panel>
        <h3 className="text-sm font-semibold text-ink">{t('admin.members.invite')}</h3>
        <form
          onSubmit={sendInvite}
          aria-label={t('admin.members.invite')}
          className="flex flex-wrap items-end gap-2"
        >
          <input
            name="email"
            type="email"
            required
            aria-label={t('admin.members.email')}
            placeholder={t('admin.members.email')}
            className={`${inputClass} min-w-48 flex-1`}
          />
          <input
            name="name"
            required
            maxLength={120}
            aria-label={t('admin.members.name')}
            placeholder={t('admin.members.name')}
            className={`${inputClass} min-w-40 flex-1`}
          />
          <select name="roleId" aria-label={t('admin.members.role')} className={inputClass}>
            <option value="">{t('admin.members.noRole')}</option>
            {data?.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabel(t, role)}
              </option>
            ))}
          </select>
          <select name="scope" aria-label={t('admin.members.scope')} className={inputClass}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass}>
            {t('admin.members.send')}
          </button>
        </form>
        {invite && <InviteLink {...invite} />}
      </Panel>

      {data?.members.length === 0 && (
        <p className="text-sm text-ink-muted">{t('admin.members.empty')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {data?.members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            data={data}
            isSelf={member.id === currentMemberId}
            options={options}
            run={run}
            onInvite={setInvite}
          />
        ))}
      </ul>
    </section>
  );
}

function InviteLink({ email, url, emailed }: { email: string; url: string; emailed: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md bg-hover p-3 text-sm">
      <span className="text-ink">{t('admin.members.inviteLink', { email })}</span>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label={t('admin.members.inviteLink', { email })}
          className={`${inputClass} flex-1 font-mono text-xs`}
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            void copyText(url).then((ok) => ok && setCopied(true));
          }}
        >
          {copied ? t('admin.members.copied') : t('admin.members.copy')}
        </button>
      </div>
      <span className="text-xs text-ink-muted">
        {emailed ? t('admin.members.emailed') : t('admin.members.notEmailed')}
      </span>
    </div>
  );
}

function MemberRow({
  member,
  data,
  isSelf,
  options,
  run,
  onInvite,
}: {
  member: AdminMember;
  data: Data;
  isSelf: boolean;
  options: ReturnType<typeof scopeOptions>;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onInvite: (invite: { email: string; url: string; emailed: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState('organization');
  const [teamId, setTeamId] = useState('');

  const teams = data.departments.flatMap((department) =>
    department.teams
      .filter((team) => !team.archivedAt)
      .map((team) => ({ ...team, label: `${department.name} / ${team.name}` })),
  );
  const statusKey = {
    invited: 'statusInvited',
    active: 'statusActive',
    deactivated: 'statusDeactivated',
  }[member.status];

  return (
    <li>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-medium text-ink">
              {member.name}
              {isSelf && (
                <span className="ml-1 text-xs text-ink-faint">({t('admin.members.you')})</span>
              )}
            </span>
            <span className="text-xs text-ink-muted">{member.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
              {t(`admin.members.${statusKey}`)}
            </span>
            {member.status === 'invited' && (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={async () => {
                  const result = await run(() => api.reinvite(member.id));
                  if (result)
                    onInvite({
                      email: member.email,
                      url: result.inviteUrl,
                      emailed: result.emailed,
                    });
                }}
              >
                {t('admin.members.resend')}
              </button>
            )}
            {!isSelf && member.status !== 'invited' && (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() =>
                  void run(() =>
                    api.setMemberStatus(
                      member.id,
                      member.status === 'active' ? 'deactivated' : 'active',
                    ),
                  )
                }
              >
                {member.status === 'active'
                  ? t('admin.members.deactivate')
                  : t('admin.members.reactivate')}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {member.roles.map((role) => {
            const label = `${roleLabel(t, { key: role.roleKey, name: role.roleName })} · ${scopeLabel(t, role.scope, data.departments)}`;
            return (
              <span
                key={role.assignmentId}
                className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-ink"
              >
                {label}
                <button
                  type="button"
                  aria-label={t('admin.members.removeRole', { role: label })}
                  className="text-ink-faint hover:text-ink"
                  onClick={() => void run(() => api.removeRole(member.id, role.assignmentId))}
                >
                  ×
                </button>
              </span>
            );
          })}
          <select
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
            aria-label={`${t('admin.members.role')}: ${member.name}`}
            className={`${inputClass} text-xs`}
          >
            <option value="">{t('admin.members.addRole')}</option>
            {data.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabel(t, role)}
              </option>
            ))}
          </select>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            aria-label={`${t('admin.members.scope')}: ${member.name}`}
            className={`${inputClass} text-xs`}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!roleId}
            className={ghostButtonClass}
            onClick={async () => {
              const target = options.find((o) => o.value === scope)?.scope;
              if (!target) return;
              const done = await run(() => api.assignRole(member.id, { roleId, scope: target }));
              if (done) setRoleId('');
            }}
          >
            {t('admin.members.addRole')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-faint">{t('admin.members.teams')}:</span>
          {member.teamIds.map((id) => {
            const team = teams.find((tm) => tm.id === id);
            if (!team) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-ink"
              >
                {team.label}
                <button
                  type="button"
                  aria-label={t('admin.members.removeFromTeam', { team: team.label })}
                  className="text-ink-faint hover:text-ink"
                  onClick={() => void run(() => api.removeFromTeam(id, member.id))}
                >
                  ×
                </button>
              </span>
            );
          })}
          <select
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            aria-label={`${t('admin.members.addToTeam')}: ${member.name}`}
            className={`${inputClass} text-xs`}
          >
            <option value="">{t('admin.members.addToTeam')}</option>
            {teams
              .filter((team) => !member.teamIds.includes(team.id))
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={!teamId}
            className={ghostButtonClass}
            onClick={async () => {
              const done = await run(() => api.addToTeam(teamId, member.id));
              if (done) setTeamId('');
            }}
          >
            {t('admin.members.addToTeam')}
          </button>
        </div>
      </Panel>
    </li>
  );
}
