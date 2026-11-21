import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';

const TABS = [
  { href: '/settings/tokens', key: 'tokens.title' },
  { href: '/settings/out-of-office', key: 'outOfOffice.title' },
  { href: '/settings/slack', key: 'slack.title' },
  { href: '/settings/appearance', key: 'appearance.title' },
] as const;

/** Personal settings pages, side by side. */
export function SettingsTabs({ path }: { path: string }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('outOfOffice.settings')}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 pt-4 md:px-6"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={path === tab.href ? 'page' : undefined}
          className={`shrink-0 rounded-t-md px-3 py-1.5 text-sm whitespace-nowrap ${
            path === tab.href ? 'bg-hover text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
