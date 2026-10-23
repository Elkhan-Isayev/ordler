import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleCheck,
  FolderKanban,
  Inbox,
  Layers,
  Mountain,
  Send,
  Settings,
  Stamp,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '../router.js';

export interface SidebarTeam {
  id: string;
  key: string;
  name: string;
  /** Team leads and admins see the team's settings. */
  manage?: boolean;
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
  /** Shown to members holding any administration permission. */
  showAdmin?: boolean;
  currentPath?: string;
  /** Opens the command palette (Cmd/Ctrl+K). */
  onSearch?: () => void;
}

const CurrentPath = createContext<string | undefined>(undefined);

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
  showAdmin = false,
  currentPath,
  onSearch,
}: SidebarProps) {
  const { t } = useTranslation();

  return (
    <CurrentPath.Provider value={currentPath}>
      <nav
        aria-label={workspaceName}
        className="flex h-full w-64 flex-col gap-6 overflow-y-auto bg-sidebar px-3 py-4 text-sm text-ink-muted"
      >
        <div className="flex items-center gap-2 px-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent text-xs font-semibold text-white">
            {workspaceName.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate font-semibold text-ink">{workspaceName}</span>
          {onSearch && (
            <button
              type="button"
              onClick={onSearch}
              title="Ctrl+K"
              className="ml-auto rounded-md px-2 py-1 text-xs hover:bg-hover hover:text-ink"
            >
              {t('nav.search')}
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-0.5">
          <NavItem icon={Inbox} href="/inbox" badge={formatBadge(inboxCount)}>
            {t('nav.inbox')}
          </NavItem>
          <NavItem icon={CircleCheck} href="/my-issues">
            {t('nav.myIssues')}
          </NavItem>
          <NavItem icon={Send} href="/my-requests">
            {t('nav.myRequests')}
          </NavItem>
          <NavItem
            icon={Stamp}
            href="/approvals"
            badge={formatBadge(pendingApprovals)}
            badgeLabel={t('nav.pendingApprovals', { count: pendingApprovals })}
          >
            {t('nav.approvals')}
          </NavItem>
        </ul>

        <Section title={t('nav.workspace')}>
          <NavItem icon={Mountain} href="/initiatives">
            {t('nav.initiatives')}
          </NavItem>
          <NavItem icon={FolderKanban} href="/projects">
            {t('nav.projects')}
          </NavItem>
          <NavItem icon={Layers} href="/views">
            {t('nav.views')}
          </NavItem>
          <NavItem icon={Store} href="/portals">
            {t('nav.servicePortals')}
          </NavItem>
          {showAdmin && (
            <NavItem
              icon={Settings}
              href="/admin"
              active={currentPath?.startsWith('/admin') ?? false}
            >
              {t('nav.admin')}
            </NavItem>
          )}
        </Section>

        {departments.length > 0 && (
          <Section title={t('nav.yourDepartments')}>
            {departments.map((department, index) => (
              <DepartmentNode
                key={department.id}
                department={department}
                defaultOpen={index === 0}
              />
            ))}
          </Section>
        )}
        {footer && <div className="mt-auto border-t border-line pt-3">{footer}</div>}
      </nav>
    </CurrentPath.Provider>
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
  const base = `/teams/${team.key}`;
  const current = useContext(CurrentPath);
  // The team the user is looking at starts expanded.
  const [open, setOpen] = useState(() => current?.startsWith(`${base}/`) ?? false);

  return (
    <li>
      <Toggle open={open} onToggle={() => setOpen(!open)}>
        {team.name}
      </Toggle>
      {open && (
        <ul className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
          <NavItem href={`${base}/requests`}>{t('nav.requests')}</NavItem>
          <NavItem href={`${base}/triage`}>{t('nav.triage')}</NavItem>
          <NavItem href={`${base}/issues`}>{t('nav.issues')}</NavItem>
          <NavItem href={`${base}/board`}>{t('nav.board')}</NavItem>
          <NavItem href={`${base}/cycles/current`}>
            {t('nav.cycles')} · {t('nav.currentCycle')}
          </NavItem>
          <NavItem href={`${base}/cycles/upcoming`}>
            {t('nav.cycles')} · {t('nav.upcomingCycle')}
          </NavItem>
          <NavItem href={`${base}/projects`}>{t('nav.projects')}</NavItem>
          <NavItem href={`${base}/views`}>{t('nav.views')}</NavItem>
          {team.manage && <NavItem href={`${base}/settings`}>{t('nav.teamSettings')}</NavItem>}
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
  active,
  icon: Icon,
  children,
}: {
  href: string;
  badge?: string | undefined;
  badgeLabel?: string;
  active?: boolean;
  icon?: LucideIcon | undefined;
  children: ReactNode;
}) {
  const current = useContext(CurrentPath);
  active ??= current === href;
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover hover:text-ink ${
          active ? 'bg-hover font-medium text-ink' : ''
        }`}
      >
        {Icon && <Icon aria-hidden size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />}
        <span className="flex-1 truncate">{children}</span>
        {badge && (
          <span
            aria-label={badgeLabel}
            className="rounded-full bg-accent/20 px-1.5 text-[11px] font-medium text-ink"
          >
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}
