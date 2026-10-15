import { useTranslation } from 'react-i18next';
import { Sidebar, type SidebarProps } from './components/Sidebar.js';

export function App(props: SidebarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen">
      <Sidebar {...props} />
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-xl font-semibold">{t('home.title')}</h1>
        <p className="text-ink-muted">{t('home.hint')}</p>
      </main>
    </div>
  );
}
