import { DEFAULT_SOURCE_URL, type AboutResponse } from '@ordler/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  CircleCheck,
  CircleHelp,
  FolderKanban,
  Inbox,
  Layers,
  Shapes,
  Mountain,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Stamp,
  Store,
  type LucideIcon,
  Search,
} from 'lucide-react';
import { api } from '../api/client.js';
import { Link } from '../router.js';

/** Shortcut hint in the platform's own words. */
const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

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
  /** Collapsed, only a thin rail with the expand button remains. */
  collapsed?: boolean;
  /** Shows the collapse/expand button when given. */
  onToggleCollapsed?: () => void;
  /**
   * Phones: the open sidebar floats over the page as a drawer, with the rail kept in place,
   * instead of squeezing the page into a strip.
   */
  overlay?: boolean;
}

export const SIDEBAR_ID = 'app-sidebar';

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
  collapsed = false,
  onToggleCollapsed,
  overlay = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const rail = (
    <div className="flex h-full shrink-0 flex-col items-center border-r border-line bg-sidebar px-1.5 py-4">
      {collapsed && onToggleCollapsed && <CollapseButton collapsed onToggle={onToggleCollapsed} />}
    </div>
  );

  if (collapsed && onToggleCollapsed) return rail;

  const drawer = overlay && onToggleCollapsed !== undefined;
  const nav = (
    <CurrentPath.Provider value={currentPath}>
      <nav
        id={SIDEBAR_ID}
        aria-label={workspaceName}
        className={`flex h-full w-64 shrink-0 flex-col gap-6 overflow-y-auto bg-sidebar px-3 py-4 text-sm text-ink-muted ${
          drawer ? 'fixed inset-y-0 left-0 z-40 max-w-[85vw] shadow-2xl' : ''
        }`}
      >
        <div className="flex items-center gap-2 px-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-white">
            {workspaceName.slice(0, 2).toUpperCase()}
          </span>
          <span className="flex-1 truncate font-semibold text-ink">{workspaceName}</span>
          {onToggleCollapsed && <CollapseButton collapsed={false} onToggle={onToggleCollapsed} />}
        </div>
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            aria-keyshortcuts={`${MOD_KEY === '⌘' ? 'Meta' : 'Control'}+K`}
            className="-mt-3 flex items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1.5 text-left text-ink-faint hover:text-ink"
          >
            <Search aria-hidden size={14} />
            <span className="flex-1">{t('nav.search')}</span>
            <kbd className="rounded border border-line px-1 text-[10px]">{MOD_KEY} K</kbd>
          </button>
        )}

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
          <NavItem icon={CircleHelp} href="/help">
            {t('nav.help')}
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
          <NavItem icon={BookOpen} href="/wiki" active={currentPath?.startsWith('/wiki') ?? false}>
            {t('nav.wiki')}
          </NavItem>
          <NavItem icon={Shapes} href="/whiteboards">
            {t('nav.whiteboards')}
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
        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
          {footer}
          <SourceLink />
        </div>
      </nav>
    </CurrentPath.Provider>
  );
  if (!drawer) return nav;
  return (
    <>
      {rail}
      {/* Tapping the dimmed page closes the drawer; Escape and the button close it too. */}
      <div
        aria-hidden
        data-testid="sidebar-backdrop"
        className="fixed inset-0 z-30 bg-black/40"
        onClick={onToggleCollapsed}
      />
      {nav}
    </>
  );
}

/** Shows or hides the sidebar; the tooltip names both shortcuts. */
function CollapseButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar');
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      aria-controls={collapsed ? undefined : SIDEBAR_ID}
      aria-keyshortcuts={`[ ${MOD_KEY === '⌘' ? 'Meta' : 'Control'}+\\`}
      title={`${label} ([ · ${MOD_KEY} \\)`}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon aria-hidden size={16} strokeWidth={1.75} />
    </button>
  );
}

/**
 * AGPL §13: everyone using an instance is offered its source. The link shows even when the
 * server cannot be asked, falling back to the public repository.
 */
export function SourceLink() {
  const { t } = useTranslation();
  const [about, setAbout] = useState<AboutResponse>();
  useEffect(() => {
    let live = true;
    api
      .about()
      .then((answer) => live && setAbout(answer))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const version = about && about.version !== 'development' ? ` ${about.version}` : '';
  return (
    <p className="px-2 text-xs text-ink-faint">
      Ordler{version} · {t('nav.license')} ·{' '}
      <a
        href={about?.sourceUrl ?? DEFAULT_SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink hover:underline"
      >
        {t('nav.sourceCode')}
      </a>
    </p>
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
