import type { MeResponse } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { AdminPage, adminSections } from './admin/AdminPage.js';
import { CommandPalette, useCommandPalette } from './components/CommandPalette.js';
import { Sidebar } from './components/Sidebar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { IssuePage } from './issues/IssuePage.js';
import { MyIssuesPage } from './issues/MyIssuesPage.js';
import { InboxPage, useInboxCounts } from './notifications/InboxPage.js';
import { TeamIssuesPage } from './issues/TeamIssuesPage.js';
import { CyclePage, CyclesPage } from './cycles/CyclePages.js';
import { InitiativePage, InitiativesPage } from './projects/InitiativePages.js';
import { ProjectPage } from './projects/ProjectPage.js';
import { ProjectsPage } from './projects/ProjectsPage.js';
import { TeamSettingsPage } from './issues/TeamSettingsPage.js';
import { TriagePage } from './issues/TriagePage.js';
import { NewRequestPage } from './requests/NewRequestPage.js';
import { PortalsPage } from './requests/PortalsPage.js';
import {
  ApprovalsPage,
  DepartmentRequestsPage,
  MyRequestsPage,
  RequestGroupPage,
  TeamRequestsPage,
} from './requests/RequestLists.js';
import { RequestPage } from './requests/RequestPage.js';
import { OutOfOfficePage } from './settings/OutOfOfficePage.js';
import { SettingsTabs } from './settings/SettingsTabs.js';
import { TokensPage } from './settings/TokensPage.js';
import { Link, usePathname } from './router.js';

export function App({ me, onSignOut }: { me: MeResponse; onSignOut: () => void }) {
  const { t } = useTranslation();
  const path = usePathname();
  const adminSection = /^\/admin(?:\/([A-Za-z]+))?\/?$/.exec(path);
  const teamPage = /^\/teams\/([A-Za-z0-9]+)\/(issues|board)\/?$/.exec(path);
  const triagePage = /^\/teams\/([A-Za-z0-9]+)\/triage\/?$/.exec(path);
  const cyclesPage = /^\/teams\/([A-Za-z0-9]+)\/cycles(?:\/(current|upcoming))?\/?$/.exec(path);
  const cyclePage = /^\/cycles\/([0-9a-f-]{36})\/?$/.exec(path);
  const projectPage = /^\/projects\/([0-9a-f-]{36})\/?$/.exec(path);
  const initiativePage = /^\/initiatives\/([0-9a-f-]{36})\/?$/.exec(path);
  const teamProjects = /^\/teams\/([A-Za-z0-9]+)\/projects\/?$/.exec(path);
  const teamRequests = /^\/teams\/([A-Za-z0-9]+)\/requests\/?$/.exec(path);
  const teamIntegrations = /^\/teams\/([A-Za-z0-9]+)\/settings\/?$/.exec(path);
  const managedTeam = teamIntegrations
    ? me.departments
        .flatMap((d) => d.teams)
        .find((team) => team.manage && team.key === teamIntegrations[1]!.toUpperCase())
    : undefined;
  const departmentRequests = /^\/departments\/([0-9a-f-]{36})\/requests\/?$/.exec(path);
  const newRequest = /^\/portals\/new\/([0-9a-f-]{36})\/?$/.exec(path);
  const newGroup = /^\/portals\/group\/([0-9a-f,-]+)\/?$/.exec(path);
  const requestPage = /^\/requests\/(REQ-\d+)\/?$/i.exec(path);
  const groupPage = /^\/request-groups\/(REQ-G-\d+)\/?$/i.exec(path);
  const issuePage = /^\/issue\/([A-Za-z0-9]+-\d+)\/?$/.exec(path);
  const canAdminister = adminSections(me.organizationPermissions).length > 0;
  const counts = useInboxCounts(me.member.id);
  const [searching, setSearching] = useCommandPalette();

  return (
    <div className="flex h-screen">
      {searching && <CommandPalette onClose={() => setSearching(false)} />}
      <Sidebar
        workspaceName={me.workspace.companyName}
        inboxCount={counts.unread}
        pendingApprovals={counts.approvals}
        onSearch={() => setSearching(true)}
        departments={me.departments}
        showAdmin={canAdminister}
        currentPath={path}
        footer={
          <div className="flex items-center justify-between gap-2 px-2">
            <Link
              href="/settings/tokens"
              title={t('tokens.title')}
              className="truncate text-ink hover:underline"
            >
              {me.member.name}
            </Link>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-md px-2 py-1 text-xs hover:bg-hover hover:text-ink"
            >
              {t('auth.signOut')}
            </button>
          </div>
        }
      />
      <div className="flex flex-1 flex-col overflow-y-auto">
        <UpdateBanner isAdmin={me.organizationPermissions.includes('org.manage')} />
        {adminSection ? (
          <AdminPage me={me} section={adminSection[1]} />
        ) : teamPage ? (
          <TeamIssuesPage
            key={teamPage[1]}
            teamKey={teamPage[1]!.toUpperCase()}
            view={teamPage[2] === 'board' ? 'board' : 'list'}
          />
        ) : cyclesPage ? (
          <CyclesPage
            key={path}
            teamKey={cyclesPage[1]!.toUpperCase()}
            filter={(cyclesPage[2] as 'current' | 'upcoming' | undefined) ?? 'all'}
          />
        ) : path === '/initiatives' ? (
          <InitiativesPage canCreate={me.organizationPermissions.includes('initiative.manage')} />
        ) : initiativePage ? (
          <InitiativePage key={initiativePage[1]} initiativeId={initiativePage[1]!} />
        ) : path === '/projects' ? (
          <ProjectsPage />
        ) : teamProjects ? (
          <ProjectsPage key={teamProjects[1]} teamKey={teamProjects[1]!.toUpperCase()} />
        ) : projectPage ? (
          <ProjectPage key={projectPage[1]} projectId={projectPage[1]!} />
        ) : cyclePage ? (
          <CyclePage key={cyclePage[1]} cycleId={cyclePage[1]!} />
        ) : triagePage ? (
          <TriagePage key={triagePage[1]} teamKey={triagePage[1]!.toUpperCase()} />
        ) : teamRequests ? (
          <TeamRequestsPage key={teamRequests[1]} teamKey={teamRequests[1]!.toUpperCase()} />
        ) : managedTeam ? (
          <TeamSettingsPage key={managedTeam.id} teamKey={managedTeam.key} />
        ) : departmentRequests ? (
          <DepartmentRequestsPage
            key={departmentRequests[1]}
            departmentId={departmentRequests[1]!}
          />
        ) : path === '/portals' ? (
          <PortalsPage />
        ) : newRequest ? (
          <NewRequestPage key={newRequest[1]} typeIds={[newRequest[1]!]} />
        ) : newGroup ? (
          <NewRequestPage key={newGroup[1]} typeIds={newGroup[1]!.split(',')} />
        ) : requestPage ? (
          <RequestPage key={requestPage[1]} identifier={requestPage[1]!.toUpperCase()} />
        ) : groupPage ? (
          <RequestGroupPage key={groupPage[1]} identifier={groupPage[1]!.toUpperCase()} />
        ) : path === '/settings/tokens' ? (
          <div className="flex flex-col">
            <SettingsTabs path={path} />
            <TokensPage />
          </div>
        ) : path === '/settings/out-of-office' ? (
          <div className="flex flex-col">
            <SettingsTabs path={path} />
            <OutOfOfficePage memberId={me.member.id} />
          </div>
        ) : path === '/inbox' ? (
          <InboxPage memberId={me.member.id} />
        ) : path === '/my-requests' ? (
          <MyRequestsPage />
        ) : path === '/approvals' ? (
          <ApprovalsPage />
        ) : issuePage ? (
          <IssuePage key={issuePage[1]} identifier={issuePage[1]!.toUpperCase()} />
        ) : path === '/my-issues' ? (
          <MyIssuesPage />
        ) : (
          <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <h1 className="text-xl font-semibold">{t('home.title')}</h1>
            <p className="text-ink-muted">{t('home.hint')}</p>
          </main>
        )}
      </div>
    </div>
  );
}
