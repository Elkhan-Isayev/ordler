import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';

const TABS = [
  { href: '/settings/tokens', key: 'tokens.title' },
  { href: '/settings/out-of-office', key: 'outOfOffice.title' },
] as const;

/** Personal settings pages, side by side. */
export function SettingsTabs({ path }: { path: string }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('outOfOffice.settings')}
      className="flex gap-1 border-b border-line px-6 pt-4"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={path === tab.href ? 'page' : undefined}
          className={`rounded-t-md px-3 py-1.5 text-sm ${
            path === tab.href ? 'bg-hover text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
