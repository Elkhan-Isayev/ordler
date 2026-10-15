import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface SidebarTeam {
  id: string;
  key: string;
  name: string;
}

export interface SidebarDepartment {
  id: string;
  name: string;
  teams: SidebarTeam[];
}

export interface SidebarProps {
  workspaceName: string;
  inboxCount: number;
  pendingApprovals: number;
  departments: SidebarDepartment[];
  /** Pinned to the bottom: the signed-in member and their actions. */
  footer?: ReactNode;
}

/** Badges cap like Linear's, so the sidebar width stays stable. */
export function formatBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

/** Left navigation (SPEC §5.3): personal items, workspace, then departments with their teams. */
export function Sidebar({
  workspaceName,
  inboxCount,
  pendingApprovals,
  departments,
  footer,
}: SidebarProps) {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={workspaceName}
      className="flex h-full w-64 flex-col gap-6 overflow-y-auto bg-sidebar px-3 py-4 text-sm text-ink-muted"
    >
      <div className="flex items-center gap-2 px-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent text-xs font-semibold text-white">
          {workspaceName.slice(0, 2).toUpperCase()}
        </span>
        <span className="truncate font-semibold text-ink">{workspaceName}</span>
      </div>

      <ul className="flex flex-col gap-0.5">
        <NavItem href="/inbox" badge={formatBadge(inboxCount)}>
          {t('nav.inbox')}
        </NavItem>
        <NavItem href="/my-issues">{t('nav.myIssues')}</NavItem>
        <NavItem href="/my-requests">{t('nav.myRequests')}</NavItem>
        <NavItem
          href="/approvals"
          badge={formatBadge(pendingApprovals)}
          badgeLabel={t('nav.pendingApprovals', { count: pendingApprovals })}
        >
          {t('nav.approvals')}
        </NavItem>
      </ul>

      <Section title={t('nav.workspace')}>
        <NavItem href="/initiatives">{t('nav.initiatives')}</NavItem>
        <NavItem href="/projects">{t('nav.projects')}</NavItem>
        <NavItem href="/views">{t('nav.views')}</NavItem>
        <NavItem href="/portals">{t('nav.servicePortals')}</NavItem>
      </Section>

      {departments.length > 0 && (
        <Section title={t('nav.yourDepartments')}>
          {departments.map((department, index) => (
            <DepartmentNode key={department.id} department={department} defaultOpen={index === 0} />
          ))}
        </Section>
      )}
      {footer && <div className="mt-auto border-t border-line pt-3">{footer}</div>}
    </nav>
  );
}

function DepartmentNode({
  department,
  defaultOpen,
}: {
  department: SidebarDepartment;
  defaultOpen: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <li>
      <Toggle open={open} onToggle={() => setOpen(!open)}>
        {department.name}
      </Toggle>
      {open && (
        <ul className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
          <NavItem href={`/departments/${department.id}/requests`}>{t('nav.requests')}</NavItem>
          {department.teams.map((team) => (
            <TeamNode key={team.id} team={team} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TeamNode({ team }: { team: SidebarTeam }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const base = `/teams/${team.key}`;

  return (
    <li>
      <Toggle open={open} onToggle={() => setOpen(!open)}>
        {team.name}
      </Toggle>
      {open && (
        <ul className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
          <NavItem href={`${base}/triage`}>{t('nav.triage')}</NavItem>
          <NavItem href={`${base}/issues`}>{t('nav.issues')}</NavItem>
          <NavItem href={`${base}/cycles/current`}>
            {t('nav.cycles')} · {t('nav.currentCycle')}
          </NavItem>
          <NavItem href={`${base}/cycles/upcoming`}>
            {t('nav.cycles')} · {t('nav.upcomingCycle')}
          </NavItem>
          <NavItem href={`${base}/projects`}>{t('nav.projects')}</NavItem>
          <NavItem href={`${base}/views`}>{t('nav.views')}</NavItem>
        </ul>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-2 text-xs font-medium text-ink-faint">{title}</h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

function Toggle({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left hover:bg-hover hover:text-ink"
    >
      <span aria-hidden className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>
        ▶
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function NavItem({
  href,
  badge,
  badgeLabel,
  children,
}: {
  href: string;
  badge?: string | undefined;
  badgeLabel?: string;
  children: ReactNode;
}) {
  return (
    <li>
      <a
        href={href}
        className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-hover hover:text-ink"
      >
        <span className="truncate">{children}</span>
        {badge && (
          <span aria-label={badgeLabel} className="text-xs text-ink-faint">
            {badge}
          </span>
        )}
      </a>
    </li>
  );
}
