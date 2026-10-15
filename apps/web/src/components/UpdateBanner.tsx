import type { UpdateStatusResponse } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';

export const DISMISSED_UPDATE_KEY = 'ordler.dismissedUpdate';

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    // Private mode or blocked storage: the banner simply returns on the next visit.
  }
}

/**
 * New-version notice for admins (SPEC §16.5). Rendered only for members with `org.manage`;
 * dismissing hides it until a newer release appears.
 */
export function UpdateBanner({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatusResponse>();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [showHowTo, setShowHowTo] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api
      .updateStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      // The banner is a convenience; failures must never disturb the app.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin || !status?.updateAvailable || !status.latestVersion) return null;
  if (dismissed === status.latestVersion) return null;
  const latest = status.latestVersion;

  return (
    <section
      role="status"
      aria-label={t('updates.title', { latest })}
      className="m-4 flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-ink">{t('updates.title', { latest })}</p>
          <p className="text-ink-muted">
            {t('updates.current', { current: status.currentVersion })}
          </p>
          {status.majorUpgrade && <p className="text-amber-600">{t('updates.major')}</p>}
        </div>
        <div className="flex items-center gap-2">
          {status.release && (
            <a
              href={status.release.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2 py-1 text-accent hover:bg-hover"
            >
              {t('updates.releaseNotes')}
            </a>
          )}
          <button
            type="button"
            aria-expanded={showHowTo}
            onClick={() => setShowHowTo(!showHowTo)}
            className="rounded-md bg-accent px-3 py-1 font-medium text-white hover:opacity-90"
          >
            {showHowTo ? t('updates.hideHowTo') : t('updates.howTo')}
          </button>
          <button
            type="button"
            onClick={() => {
              writeDismissed(latest);
              setDismissed(latest);
            }}
            className="rounded-md px-2 py-1 text-ink-muted hover:bg-hover hover:text-ink"
          >
            {t('updates.dismiss')}
          </button>
        </div>
      </div>
      {showHowTo && (
        <div className="flex flex-col gap-2 text-ink-muted">
          <p>{t('updates.backup')}</p>
          <p>{t('updates.compose', { latest })}</p>
          <pre className="overflow-x-auto rounded-md bg-surface p-2 text-xs text-ink">
            docker compose pull && docker compose up -d
          </pre>
          <p>{t('updates.helm')}</p>
          <pre className="overflow-x-auto rounded-md bg-surface p-2 text-xs text-ink">
            {`helm upgrade ordler ordler/ordler --reuse-values --set image.tag=${latest}`}
          </pre>
          <p>{t('updates.dataSafety')}</p>
        </div>
      )}
    </section>
  );
}
