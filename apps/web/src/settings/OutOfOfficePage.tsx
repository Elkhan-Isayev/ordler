import type { DelegationView, MemberRef } from '@ordler/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buttonClass,
  ghostButtonClass,
  inputClass,
  Panel,
  SectionHeader,
} from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';

const day = (iso: string, language: string) =>
  new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/** Settings → Out of office (SPEC §6.3): who decides my approvals while I am away. */
export function OutOfOfficePage({ memberId }: { memberId: string }) {
  const { t, i18n } = useTranslation();
  const [delegations, setDelegations] = useState<DelegationView[]>();
  const [people, setPeople] = useState<MemberRef[]>([]);
  const [error, setError] = useState<string>();
  const today = new Date().toISOString().slice(0, 10);

  const reload = useCallback(() => {
    void api
      .delegations()
      .then(setDelegations)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);
  useEffect(() => {
    reload();
    void api
      .directory()
      .then((d) => setPeople(d.members.filter((m) => m.id !== memberId)))
      .catch(() => undefined);
  }, [reload, memberId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setDelegations(
        await api.createDelegation({
          delegateId: String(form.get('delegateId')),
          startsOn: String(form.get('startsOn')),
          endsOn: String(form.get('endsOn')),
        }),
      );
      setError(undefined);
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <SectionHeader title={t('outOfOffice.title')} subtitle={t('outOfOffice.subtitle')} />
      {error && <FormError message={t(error)} />}
      <Panel>
        {delegations?.length === 0 && (
          <p className="text-sm text-ink-muted">{t('outOfOffice.none')}</p>
        )}
        <ul className="flex flex-col divide-y divide-line">
          {delegations?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium text-ink">{d.delegate.name}</span>
              <span className="text-ink-muted">
                {day(d.startsOn, i18n.language)} – {day(d.endsOn, i18n.language)}
              </span>
              {d.active && (
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-ink">
                  {t('outOfOffice.active')}
                </span>
              )}
              <button
                type="button"
                className={`${ghostButtonClass} ml-auto`}
                onClick={() =>
                  void api
                    .revokeDelegation(d.id)
                    .then(reload)
                    .catch((failure: unknown) => setError(errorKey(failure)))
                }
              >
                {t('outOfOffice.remove')}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <form
          aria-label={t('outOfOffice.add')}
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => void submit(e)}
        >
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('outOfOffice.delegate')}
            <select name="delegateId" required className={selectClass}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('outOfOffice.from')}
            <input
              name="startsOn"
              type="date"
              required
              min={today}
              defaultValue={today}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            {t('outOfOffice.to')}
            <input name="endsOn" type="date" required min={today} className={inputClass} />
          </label>
          <button type="submit" className={buttonClass} disabled={people.length === 0}>
            {t('outOfOffice.add')}
          </button>
        </form>
        <p className="text-xs text-ink-faint">{t('outOfOffice.hint')}</p>
      </Panel>
    </section>
  );
}
