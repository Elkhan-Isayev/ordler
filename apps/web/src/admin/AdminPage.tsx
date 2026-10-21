import type { MeResponse, Permission } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { AuthSection } from './AuthSection.js';
import { DatabaseSection } from './DatabaseSection.js';
import { DepartmentsSection } from './DepartmentsSection.js';
import { IntegrationsSection } from './IntegrationsSection.js';
import { MailSection } from './MailSection.js';
import { RequestTypesSection } from './RequestTypesSection.js';
import { MembersSection } from './MembersSection.js';
import { UpdatesSection } from './UpdatesSection.js';

const SECTIONS: Array<{ id: string; permission: Permission }> = [
  { id: 'departments', permission: 'org.manage' },
  { id: 'members', permission: 'org.manage' },
  { id: 'requestTypes', permission: 'request_type.manage' },
  { id: 'authentication', permission: 'auth.manage' },
  { id: 'mail', permission: 'mail.manage' },
  { id: 'integrations', permission: 'team.update' },
  { id: 'database', permission: 'org.manage' },
  { id: 'updates', permission: 'org.manage' },
];

/** Sections the member may open; the server enforces the same permissions on every call. */
export function adminSections(permissions: readonly string[]): string[] {
  return SECTIONS.filter((section) => permissions.includes(section.permission)).map((s) => s.id);
}

export function AdminPage({ me, section }: { me: MeResponse; section: string | undefined }) {
  const { t } = useTranslation();
  const allowed = adminSections(me.organizationPermissions);
  if (allowed.length === 0) {
    return <p className="p-8 text-sm text-ink-muted">{t('admin.noAccess')}</p>;
  }
  const active = section && allowed.includes(section) ? section : allowed[0]!;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:flex-row">
      <nav aria-label={t('admin.title')} className="flex shrink-0 flex-col gap-1 md:w-52">
        <h1 className="px-2 pb-2 text-base font-semibold text-ink">{t('admin.title')}</h1>
        {allowed.map((id) => (
          <Link
            key={id}
            href={`/admin/${id}`}
            aria-current={id === active ? 'page' : undefined}
            className={`rounded-md px-2 py-1.5 text-sm ${
              id === active ? 'bg-hover text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink'
            }`}
          >
            {t(`admin.nav.${id}`)}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        {active === 'departments' && <DepartmentsSection />}
        {active === 'members' && <MembersSection currentMemberId={me.member.id} />}
        {active === 'requestTypes' && <RequestTypesSection />}
        {active === 'authentication' && <AuthSection />}
        {active === 'mail' && <MailSection defaultTestRecipient={me.member.email} />}
        {active === 'integrations' && <IntegrationsSection />}
        {active === 'database' && (
          <DatabaseSection canEdit={me.organizationPermissions.includes('instance.manage')} />
        )}
        {active === 'updates' && <UpdatesSection />}
      </div>
    </div>
  );
}
