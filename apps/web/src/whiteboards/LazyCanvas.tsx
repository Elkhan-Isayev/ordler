import { lazy, Suspense, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

// The editor is large; it loads only when a board is actually shown.
const WhiteboardCanvas = lazy(() => import('./WhiteboardCanvas.js'));

export type CanvasProps = ComponentProps<typeof WhiteboardCanvas>;

export function LazyCanvas(props: CanvasProps) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <p className="flex h-full items-center justify-center text-sm text-ink-muted">
          {t('whiteboards.loading')}
        </p>
      }
    >
      <WhiteboardCanvas {...props} />
    </Suspense>
  );
}
