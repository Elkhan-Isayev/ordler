import type { MeResponse, Permission } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { Link } from '../router.js';
import { AuditSection } from './AuditSection.js';
import { AuthSection } from './AuthSection.js';
import { DatabaseSection } from './DatabaseSection.js';
import { DepartmentsSection } from './DepartmentsSection.js';
import { GithubAppPanel } from './GithubAppPanel.js';
import { ImportSection } from './ImportSection.js';
import { IntegrationsSection } from './IntegrationsSection.js';
import { MailSection } from './MailSection.js';
import { SlackAppPanel } from './SlackAppPanel.js';
import { TokensSection } from './TokensSection.js';
import { RequestTypesSection } from './RequestTypesSection.js';
import { RolesSection } from './RolesSection.js';
import { SlaSection } from './SlaSection.js';
import { MembersSection } from './MembersSection.js';
import { UpdatesSection } from './UpdatesSection.js';
import { WebhooksSection } from './WebhooksSection.js';

const SECTIONS: Array<{ id: string; permission: Permission }> = [
  { id: 'departments', permission: 'org.manage' },
  { id: 'members', permission: 'org.manage' },
  { id: 'roles', permission: 'role.create' },
  { id: 'requestTypes', permission: 'request_type.manage' },
  { id: 'sla', permission: 'sla_policy.manage' },
  { id: 'authentication', permission: 'auth.manage' },
  { id: 'mail', permission: 'mail.manage' },
  { id: 'integrations', permission: 'team.update' },
  { id: 'tokens', permission: 'org.manage' },
  { id: 'import', permission: 'org.manage' },
  { id: 'webhooks', permission: 'webhook.manage' },
  { id: 'database', permission: 'org.manage' },
  { id: 'updates', permission: 'org.manage' },
  { id: 'audit', permission: 'org.audit.read' },
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
    <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
      {/* Phones: one scrolling row of sections above the page, not a long list before it. */}
      <nav
        aria-label={t('admin.title')}
        className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 md:mx-0 md:w-52 md:flex-col md:overflow-visible md:px-0"
      >
        <h1 className="hidden px-2 pb-2 text-base font-semibold text-ink md:block">
          {t('admin.title')}
        </h1>
        {allowed.map((id) => (
          <Link
            key={id}
            href={`/admin/${id}`}
            aria-current={id === active ? 'page' : undefined}
            className={`shrink-0 rounded-md px-2 py-1.5 text-sm whitespace-nowrap ${
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
        {active === 'sla' && <SlaSection />}
        {active === 'authentication' && <AuthSection />}
        {active === 'mail' && <MailSection defaultTestRecipient={me.member.email} />}
        {active === 'integrations' && (
          <div className="flex flex-col gap-4">
            {me.organizationPermissions.includes('org.manage') && <SlackAppPanel />}
            {me.organizationPermissions.includes('integration.manage') && <GithubAppPanel />}
            <IntegrationsSection />
          </div>
        )}
        {active === 'tokens' && <TokensSection />}
        {active === 'import' && <ImportSection />}
        {active === 'webhooks' && <WebhooksSection />}
        {active === 'database' && (
          <DatabaseSection canEdit={me.organizationPermissions.includes('instance.manage')} />
        )}
        {active === 'updates' && <UpdatesSection />}
        {active === 'roles' && <RolesSection />}
        {active === 'audit' && <AuditSection />}
      </div>
    </div>
  );
}
