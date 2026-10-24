import type {
  AdminDepartment,
  ImportConfig,
  ImportContainer,
  ImportDryRun,
  ImportOptions,
  ImportRunView,
  ImportSource,
  MemberRef,
  WorkflowStatus,
} from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { buttonClass, ghostButtonClass, inputClass, Panel, SectionHeader } from './common.js';

const POLL_MS = 2000;

interface Target {
  /** Existing team id, or `new` for a team created from the source container. */
  teamId: string;
  newName: string;
  newKey: string;
  departmentId: string;
}

/** Admin → Import (SPEC §10.2): connect by token, choose and map, dry run, run, report. */
export function ImportSection() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<ImportRunView[]>([]);
  const [run, setRun] = useState<ImportRunView>();
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    void api
      .imports()
      .then(setRuns)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);
  useEffect(reload, [reload]);

  // While a run works in the background, keep its progress fresh.
  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = setInterval(() => {
      void api
        .importRun(run.id)
        .then((next) => {
          setRun(next);
          if (next.status !== 'running') reload();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [run?.id, run?.status, reload]);

  const editing = run?.status === 'draft';

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={t('admin.nav.import')} subtitle={t('imports.subtitle')} />
      {error && <FormError message={t(error)} />}
      {!run && (
        <ConnectForm
          onConnected={(next) => {
            setRun(next);
            reload();
          }}
        />
      )}
      {run && editing && (
        <MapForm
          run={run}
          onChange={setRun}
          onClose={() => {
            setRun(undefined);
            reload();
          }}
        />
      )}
      {run && !editing && (
        <Progress
          run={run}
          onChange={(next) => {
            setRun(next);
            reload();
          }}
          onClose={() => setRun(undefined)}
        />
      )}
      {runs.length > 0 && (
        <Panel>
          <h3 className="text-sm font-semibold text-ink">{t('imports.history')}</h3>
          <ul className="flex flex-col">
            {runs.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
                  onClick={() => setRun(item)}
                >
                  <span className="font-medium text-ink">{t(`imports.source.${item.source}`)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">
                    {item.baseUrl ?? item.account.name}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {t('imports.countsShort', { ...item.counts })}
                  </span>
                  <StatusPill status={item.status} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: ImportRunView['status'] }) {
  const { t } = useTranslation();
  return (
    <span className="rounded-full bg-hover px-2 py-0.5 text-xs text-ink-muted">
      {t(`imports.status.${status}`)}
    </span>
  );
}

function ConnectForm({ onConnected }: { onConnected: (run: ImportRunView) => void }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<ImportSource>('linear');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const token = String(form.get('token') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    setBusy(true);
    setError(undefined);
    try {
      onConnected(
        await api.connectImport(
          source === 'linear'
            ? { source, token }
            : {
                source,
                baseUrl: String(form.get('baseUrl') ?? '').trim(),
                token,
                ...(email ? { email } : {}),
              },
        ),
      );
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <fieldset className="flex gap-4">
          <legend className="mb-2 text-sm font-semibold text-ink">{t('imports.connect')}</legend>
          {(['linear', 'jira'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="source"
                checked={source === value}
                onChange={() => setSource(value)}
              />
              {t(`imports.source.${value}`)}
            </label>
          ))}
        </fieldset>
        {source === 'jira' && (
          <>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('imports.baseUrl')}
              <input
                name="baseUrl"
                type="url"
                required
                placeholder="https://acme.atlassian.net"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              {t('imports.email')}
              <input
                name="email"
                type="email"
                autoComplete="off"
                aria-describedby="import-email-hint"
                className={inputClass}
              />
            </label>
            <p id="import-email-hint" className="-mt-2 text-xs text-ink-faint">
              {t('imports.emailHint')}
            </p>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t(`imports.tokenLabel.${source}`)}
          <input
            name="token"
            type="password"
            required
            minLength={10}
            autoComplete="off"
            aria-describedby="import-token-hint"
            className={inputClass}
          />
        </label>
        <p id="import-token-hint" className="-mt-2 text-xs text-ink-faint">
          {t(`imports.tokenHint.${source}`)}
        </p>
        {error && <FormError message={error} />}
        <div>
          <button type="submit" className={buttonClass} disabled={busy}>
            {busy ? t('imports.connecting') : t('imports.connectButton')}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function MapForm({
  run,
  onChange,
  onClose,
}: {
  run: ImportRunView;
  onChange: (run: ImportRunView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ImportOptions>();
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [people, setPeople] = useState<MemberRef[]>([]);
  const [selected, setSelected] = useState<string[]>(
    run.config?.containers.map((c) => c.externalId) ?? [],
  );
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [statuses, setStatuses] = useState<Record<string, WorkflowStatus[]>>({});
  const [statusMap, setStatusMap] = useState<Record<string, Record<string, string>>>(
    run.config?.statusMap ?? {},
  );
  const [peopleMap, setPeopleMap] = useState<Record<string, string | null>>(
    run.config?.peopleMap ?? {},
  );
  const [includeClosed, setIncludeClosed] = useState(run.config?.includeClosed ?? true);
  const [jql, setJql] = useState(run.config?.jql ?? '');
  const [dry, setDry] = useState<ImportDryRun>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([api.importOptions(run.id), api.departments(), api.directory()])
      .then(([opts, depts, directory]) => {
        setOptions(opts);
        setPeopleMap((map) => {
          const next = { ...map };
          for (const p of opts.people) if (!(p.id in next)) next[p.id] = p.suggestedMemberId;
          return next;
        });
        setDepartments(depts.filter((d) => !d.archivedAt));
        setPeople(directory.members);
      })
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, [run.id]);

  // People suggestions refresh when the chosen containers change (Jira lists them per project).
  useEffect(() => {
    if (selected.length === 0) return;
    void api
      .importOptions(run.id, selected)
      .then((opts) => {
        setOptions((current) => (current ? { ...current, people: opts.people } : opts));
        setPeopleMap((map) => {
          const next = { ...map };
          for (const p of opts.people) if (!(p.id in next)) next[p.id] = p.suggestedMemberId;
          return next;
        });
      })
      .catch(() => undefined);
  }, [run.id, selected]);

  const teams = departments.flatMap((d) =>
    d.teams.filter((team) => !team.archivedAt).map((team) => ({ ...team, department: d.name })),
  );

  function targetOf(container: ImportContainer): Target {
    const saved = run.config?.containers.find((c) => c.externalId === container.id);
    return (
      targets[container.id] ?? {
        teamId: saved?.teamId ?? (saved?.newTeam ? 'new' : (teams[0]?.id ?? 'new')),
        newName: saved?.newTeam?.name ?? container.name,
        newKey:
          saved?.newTeam?.key ??
          container.key
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 10),
        departmentId: saved?.newTeam?.departmentId ?? departments[0]?.id ?? '',
      }
    );
  }

  function setTarget(container: ImportContainer, patch: Partial<Target>) {
    const next = { ...targetOf(container), ...patch };
    setTargets((all) => ({ ...all, [container.id]: next }));
    if (next.teamId !== 'new') {
      const team = teams.find((tm) => tm.id === next.teamId);
      if (team && !statuses[team.id]) {
        void api
          .team(team.key)
          .then((view) => setStatuses((all) => ({ ...all, [team.id]: view.statuses })))
          .catch(() => undefined);
      }
    }
  }

  const chosen = options?.containers.filter((c) => selected.includes(c.id)) ?? [];

  function config(): ImportConfig {
    return {
      containers: chosen.map((container) => {
        const target = targetOf(container);
        return target.teamId === 'new'
          ? {
              externalId: container.id,
              newTeam: {
                name: target.newName.trim(),
                key: target.newKey,
                departmentId: target.departmentId,
              },
            }
          : { externalId: container.id, teamId: target.teamId };
      }),
      statusMap,
      peopleMap,
      includeClosed,
      ...(run.source === 'jira' && jql.trim() ? { jql: jql.trim() } : {}),
    };
  }

  async function act(action: 'dry' | 'start') {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.configureImport(run.id, config());
      onChange(saved);
      if (action === 'dry') setDry(await api.dryRunImport(run.id));
      else onChange(await api.importAction(run.id, 'start'));
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setBusy(false);
    }
  }

  if (!options) {
    return (
      <Panel>
        {error ? (
          <FormError message={t(error)} />
        ) : (
          <p className="text-sm text-ink-muted">{t('imports.loading')}</p>
        )}
      </Panel>
    );
  }

  return (
    <Panel>
      <p className="text-sm text-ink-muted">
        {t('imports.connectedAs', {
          name: run.account.name,
          source: t(`imports.source.${run.source}`),
        })}
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">
          {t(`imports.containers.${run.source}`)}
        </legend>
        {options.containers.map((container) => {
          const checked = selected.includes(container.id);
          const target = targetOf(container);
          const teamStatuses = target.teamId === 'new' ? undefined : statuses[target.teamId];
          return (
            <div
              key={container.id}
              className="flex flex-col gap-2 rounded-lg border border-line p-3"
            >
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelected((ids) =>
                      checked ? ids.filter((id) => id !== container.id) : [...ids, container.id],
                    )
                  }
                />
                <span className="font-medium">{container.name}</span>
                <span className="text-ink-faint">{container.key}</span>
              </label>
              {checked && (
                <div className="flex flex-wrap items-end gap-3 pl-6">
                  <label className="flex flex-col gap-1 text-xs text-ink-muted">
                    {t('imports.target')}
                    <select
                      value={target.teamId}
                      className={selectClass}
                      onChange={(event) => setTarget(container, { teamId: event.target.value })}
                    >
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.department} / {team.name}
                        </option>
                      ))}
                      <option value="new">{t('imports.newTeam')}</option>
                    </select>
                  </label>
                  {target.teamId === 'new' && (
                    <>
                      <label className="flex flex-col gap-1 text-xs text-ink-muted">
                        {t('imports.teamName')}
                        <input
                          value={target.newName}
                          maxLength={120}
                          className={inputClass}
                          onChange={(event) =>
                            setTarget(container, { newName: event.target.value })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-ink-muted">
                        {t('imports.teamKey')}
                        <input
                          value={target.newKey}
                          maxLength={10}
                          className={`${inputClass} w-24 uppercase`}
                          onChange={(event) =>
                            setTarget(container, { newKey: event.target.value.toUpperCase() })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-ink-muted">
                        {t('imports.department')}
                        <select
                          value={target.departmentId}
                          className={selectClass}
                          onChange={(event) =>
                            setTarget(container, { departmentId: event.target.value })
                          }
                        >
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              )}
              {checked && teamStatuses && container.statuses.length > 0 && (
                <div className="flex flex-col gap-1 pl-6">
                  <span className="text-xs text-ink-muted">{t('imports.statusMap')}</span>
                  {container.statuses.map((status) => (
                    <label key={status.name} className="flex items-center gap-2 text-sm text-ink">
                      <span className="w-40 truncate">{status.name}</span>
                      <span aria-hidden className="text-ink-faint">
                        →
                      </span>
                      <select
                        aria-label={t('imports.statusFor', { name: status.name })}
                        value={statusMap[container.id]?.[status.name] ?? ''}
                        className={selectClass}
                        onChange={(event) =>
                          setStatusMap((map) => {
                            const forContainer = { ...map[container.id] };
                            if (event.target.value) forContainer[status.name] = event.target.value;
                            else delete forContainer[status.name];
                            return { ...map, [container.id]: forContainer };
                          })
                        }
                      >
                        <option value="">{t('imports.byCategory')}</option>
                        {teamStatuses.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      {options.people.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-ink">{t('imports.people')}</legend>
          <p className="text-xs text-ink-muted">{t('imports.peopleHint')}</p>
          {options.people.map((person) => (
            <label key={person.id} className="flex items-center gap-2 text-sm text-ink">
              <span className="w-56 truncate">
                {person.name}
                {person.email && <span className="text-ink-faint"> · {person.email}</span>}
              </span>
              <span aria-hidden className="text-ink-faint">
                →
              </span>
              <select
                aria-label={t('imports.personFor', { name: person.name })}
                value={peopleMap[person.id] ?? ''}
                className={selectClass}
                onChange={(event) =>
                  setPeopleMap((map) => ({ ...map, [person.id]: event.target.value || null }))
                }
              >
                <option value="">{t('imports.nobody')}</option>
                {people.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={includeClosed}
          onChange={(event) => setIncludeClosed(event.target.checked)}
        />
        {t('imports.includeClosed')}
      </label>
      {run.source === 'jira' && (
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('imports.jql')}
          <input
            value={jql}
            maxLength={2000}
            placeholder="labels = migrate"
            className={inputClass}
            onChange={(event) => setJql(event.target.value)}
          />
        </label>
      )}
      {dry && <DryRunResult dry={dry} />}
      {error && <FormError message={error} />}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ghostButtonClass}
          disabled={busy || chosen.length === 0}
          onClick={() => void act('dry')}
        >
          {t('imports.dryRun')}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy || chosen.length === 0}
          onClick={() => void act('start')}
        >
          {t('imports.start')}
        </button>
        <button
          type="button"
          className={`${ghostButtonClass} ml-auto`}
          onClick={() =>
            void api
              .importAction(run.id, 'cancel')
              .then(onClose)
              .catch(() => onClose())
          }
        >
          {t('imports.discard')}
        </button>
      </div>
    </Panel>
  );
}

function DryRunResult({ dry }: { dry: ImportDryRun }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex flex-col gap-1 rounded-lg bg-hover p-3 text-sm text-ink">
      <strong>{t('imports.dryRunTitle')}</strong>
      {dry.containers.map((c) => (
        <span key={c.externalId}>
          {c.name}: {t('imports.dryRunCounts', { ...c })}
        </span>
      ))}
      {dry.unmappedPeople.length > 0 && (
        <span>{t('imports.unmapped', { names: dry.unmappedPeople.join(', ') })}</span>
      )}
      {dry.oversizeAttachments > 0 && (
        <span>{t('imports.oversize', { count: dry.oversizeAttachments })}</span>
      )}
      {dry.warnings.map((warning) => (
        <span key={warning}>{t(`imports.warning.${warning}`, { defaultValue: warning })}</span>
      ))}
    </div>
  );
}

function Progress({
  run,
  onChange,
  onClose,
}: {
  run: ImportRunView;
  onChange: (run: ImportRunView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const act = (action: 'start' | 'pause' | 'cancel') =>
    void api
      .importAction(run.id, action)
      .then(onChange)
      .catch((failure: unknown) => setError(errorKey(failure)));
  const notable = run.report.filter((item) => item.outcome === 'failed' || item.reason);

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t(`imports.source.${run.source}`)} · {run.baseUrl ?? run.account.name}
        </h3>
        <StatusPill status={run.status} />
      </div>
      <p className="text-sm text-ink">{t('imports.counts', { ...run.counts })}</p>
      {run.error && (
        <FormError
          message={t(run.error.startsWith('import_') ? `errors.${run.error}` : 'imports.failed', {
            error: run.error,
          })}
        />
      )}
      {error && <FormError message={t(error)} />}
      {notable.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ink-muted">
            {t('imports.report', { count: notable.length })}
          </summary>
          <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-xs">
            {notable.map((item, index) => (
              <li key={`${item.key}-${index}`} className="flex gap-2">
                <span className="w-20 shrink-0 font-medium text-ink">{item.key}</span>
                {item.identifier && <span className="text-ink-muted">→ {item.identifier}</span>}
                <span className="text-ink-muted">
                  {item.outcome === 'failed'
                    ? item.reason
                    : item.reason?.startsWith('not_imported:')
                      ? t('imports.notImported', { fields: item.reason.slice(13) })
                      : t(`imports.reason.${item.reason}`, { defaultValue: item.reason })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {run.status === 'running' && (
          <button type="button" className={ghostButtonClass} onClick={() => act('pause')}>
            {t('imports.pause')}
          </button>
        )}
        {run.status === 'paused' && (
          <button type="button" className={buttonClass} onClick={() => act('start')}>
            {t('imports.resume')}
          </button>
        )}
        {(run.status === 'running' || run.status === 'paused') && (
          <button type="button" className={ghostButtonClass} onClick={() => act('cancel')}>
            {t('imports.cancel')}
          </button>
        )}
        <button type="button" className={`${ghostButtonClass} ml-auto`} onClick={onClose}>
          {t('imports.close')}
        </button>
      </div>
    </Panel>
  );
}
