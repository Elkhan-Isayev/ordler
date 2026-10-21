import type { PortalView } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { buttonClass } from '../admin/common.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { Link, navigate } from '../router.js';

/**
 * Service portals (SPEC §6.1): what each department offers. Picking types from several
 * departments sends one request to all of them (§6.4).
 */
export function PortalsPage() {
  const { t } = useTranslation();
  const [portals, setPortals] = useState<PortalView[]>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .portals()
      .then(setPortals)
      .catch((failure: unknown) => setError(errorKey(failure)));
  }, []);

  const chosen = Object.values(selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('nav.servicePortals')}</h1>
        {chosen.length >= 2 && (
          <button
            type="button"
            className={`${buttonClass} ml-auto`}
            onClick={() => navigate(`/portals/group/${chosen.join(',')}`)}
          >
            {t('portals.sendToSeveral', { count: chosen.length })}
          </button>
        )}
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {portals?.length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('portals.empty')}</p>
      )}
      <div className="grid gap-4 p-4 md:grid-cols-2">
        {portals?.map((portal) => (
          <section
            key={portal.department.id}
            aria-label={portal.department.name}
            className="flex flex-col gap-2 rounded-lg border border-line p-4"
          >
            <h2 className="text-sm font-semibold text-ink">{portal.department.name}</h2>
            <ul className="flex flex-col gap-1">
              {portal.requestTypes.map((type) => (
                <li key={type.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={t('portals.addToGroup', { name: type.name })}
                    checked={selected[portal.department.id] === type.id}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = { ...current };
                        // One type per department: a group has one child per department.
                        if (event.target.checked) next[portal.department.id] = type.id;
                        else delete next[portal.department.id];
                        return next;
                      })
                    }
                    className="mt-1"
                  />
                  <div className="flex flex-col">
                    <Link
                      href={`/portals/new/${type.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {type.name}
                    </Link>
                    {type.description && (
                      <span className="text-xs text-ink-muted">{type.description}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {portals && portals.length > 0 && (
        <p className="px-4 pb-4 text-xs text-ink-faint">{t('portals.groupHint')}</p>
      )}
    </div>
  );
}
