import type { MeResponse } from '@ordler/shared';
import { useTranslation } from 'react-i18next';
import { AdminPage, adminSections } from './admin/AdminPage.js';
import { Sidebar } from './components/Sidebar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { usePathname } from './router.js';

export function App({ me, onSignOut }: { me: MeResponse; onSignOut: () => void }) {
  const { t } = useTranslation();
  const path = usePathname();
  const adminSection = /^\/admin(?:\/([a-z]+))?\/?$/.exec(path);
  const canAdminister = adminSections(me.organizationPermissions).length > 0;

  return (
    <div className="flex h-screen">
      <Sidebar
        workspaceName={me.workspace.companyName}
        inboxCount={0}
        pendingApprovals={0}
        departments={me.departments}
        showAdmin={canAdminister}
        currentPath={path}
        footer={
          <div className="flex items-center justify-between gap-2 px-2">
            <span className="truncate text-ink">{me.member.name}</span>
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
