import type { DatabaseProbeError, DatabaseProbeResult } from '@ordler/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { errorKey } from '../auth/errors.js';
import { Card, FormError } from '../auth/form.js';
import { DatabaseFields, ProbeOutcome, readDatabaseForm } from './DatabaseFields.js';

const POLL_MS = 1500;

/**
 * First-run installer page (SPEC §16.4): shown while Ordler has no database. The admin
 * enters the PostgreSQL connection and the install token from the container log; Ordler
 * then creates its tables and continues with the setup wizard.
 */
export function DatabaseSetupPage({
  savedError,
  onReady,
  pollMs = POLL_MS,
}: {
  savedError?: DatabaseProbeError | undefined;
  onReady: () => void;
  pollMs?: number;
}) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<DatabaseProbeResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  // After saving, the installer hands over to the real application; wait until it answers.
  useEffect(() => {
    if (!starting) return;
    let stopped = false;
    const timer = setInterval(() => {
      void api
        .setupStatus()
        .then((status) => {
          if (!stopped && !status.databaseRequired) {
            stopped = true;
            clearInterval(timer);
            onReady();
          }
        })
        .catch(() => undefined);
    }, pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [starting, onReady, pollMs]);

  async function run(save: boolean) {
    const form = formRef.current;
    if (!form?.reportValidity()) return;
    const values = new FormData(form);
    const body = {
      ...readDatabaseForm(values),
      installToken: String(values.get('installToken') ?? '').trim(),
    };
    setError(undefined);
    setResult(undefined);
    setBusy(true);
    try {
      const outcome = save ? await api.installDatabase(body) : await api.testInstallDatabase(body);
      setResult(outcome);
      if (save && outcome.ok) setStarting(true);
    } catch (failure) {
      setError(t(errorKey(failure)));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(true);
  }

  if (starting) {
    return (
      <Card title={t('database.setupTitle')} subtitle={t('database.starting')}>
        <p role="status" className="text-sm text-ink-muted">
          {t('database.startingHint')}
        </p>
      </Card>
    );
  }

  return (
    <Card title={t('database.setupTitle')} subtitle={t('database.setupSubtitle')} wide>
      {savedError && (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {t('database.savedFailed', { reason: t(`database.errors.${savedError}`) })}
        </p>
      )}
      <form
        ref={formRef}
        onSubmit={submit}
        aria-label={t('database.setupTitle')}
        className="flex flex-col gap-4"
      >
        <DatabaseFields />
        <div className="flex flex-col gap-1 text-xs text-ink-muted">
          <label className="flex flex-col gap-1">
            {t('database.installToken')}
            <input
              name="installToken"
              required
              autoComplete="off"
              placeholder="XXXX-XXXX-XXXX"
              aria-describedby="install-token-hint"
              className={`${inputClass} font-mono`}
            />
          </label>
          <span id="install-token-hint" className="text-ink-faint">
            {t('database.installTokenHint')}
          </span>
        </div>
        <FormError message={error} />
        <ProbeOutcome result={result} />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className={ghostButtonClass}
            onClick={() => void run(false)}
          >
            {t('database.test')}
          </button>
          <button type="submit" disabled={busy} className={buttonClass}>
            {t('database.saveAndContinue')}
          </button>
        </div>
      </form>
    </Card>
  );
}
