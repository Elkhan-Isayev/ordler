import { THEMES, type Theme } from '@ordler/shared';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel, SectionHeader } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { applyTheme, currentTheme } from '../theme/theme.js';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Settings → Appearance (SPEC §5.4): light, dark or the operating system's choice. */
export function AppearancePage() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [error, setError] = useState<string>();

  async function choose(next: Theme) {
    const previous = theme;
    // Applied at once; the server copy makes it follow the member to other devices.
    setTheme(next);
    applyTheme(next);
    setError(undefined);
    try {
      await api.updatePreferences({ theme: next });
    } catch (failure) {
      setTheme(previous);
      applyTheme(previous);
      setError(errorKey(failure));
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <SectionHeader title={t('appearance.title')} subtitle={t('appearance.subtitle')} />
      {error && <FormError message={t(error)} />}
      <Panel>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium text-ink">{t('appearance.theme')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {THEMES.map((option) => {
              const Icon = ICONS[option];
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                    theme === option
                      ? 'border-accent bg-accent/10 text-ink'
                      : 'border-line text-ink-muted hover:bg-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option}
                    checked={theme === option}
                    onChange={() => void choose(option)}
                    className="sr-only"
                  />
                  <Icon aria-hidden size={16} />
                  {t(`appearance.themes.${option}`)}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-ink-faint">{t('appearance.diagramsHint')}</p>
        </fieldset>
      </Panel>
    </section>
  );
}
