import { splitWikiContent, type WhiteboardView } from '@ordler/shared';
import { Maximize2, Shapes } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { RichEditor } from '../editor/RichEditor.js';
import { Link } from '../router.js';
import { LazyCanvas } from '../whiteboards/LazyCanvas.js';

/**
 * A wiki page as readers see it: Markdown with diagrams in place. A paragraph that is only a
 * link to a whiteboard shows the live board there, the same embed as on an issue (SPEC §5.6).
 */
export function WikiContent({ content, label }: { content: string; label: string }) {
  const { t } = useTranslation();
  const parts = splitWikiContent(content);
  const root = useRef<HTMLDivElement>(null);

  // A deep link (`/wiki/page/<id>#slug`) lands on its heading once the text has rendered.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const frame = requestAnimationFrame(() => scrollToAnchor(root.current, hash));
    return () => cancelAnimationFrame(frame);
  }, [content]);

  if (parts.length === 0) {
    return <p className="text-sm text-ink-faint">{t('wiki.emptyPage')}</p>;
  }
  return (
    // Capture phase: the editor's link handler would otherwise open `#slug` as a new tab.
    <div ref={root} className="flex flex-col gap-4" onClickCapture={followAnchor}>
      {parts.map((part, i) =>
        part.kind === 'markdown' ? (
          // Keyed by text: the read-only editor takes its content only when mounted.
          <RichEditor
            key={`${i}:${part.markdown}`}
            value={part.markdown}
            editable={false}
            label={label}
          />
        ) : (
          <WikiWhiteboard key={`${i}:${part.id}`} id={part.id} title={part.title} />
        ),
      )}
    </div>
  );
}

/** Scrolls to the heading a `#slug` names; false when the page has no such heading. */
export function scrollToAnchor(root: HTMLElement | null, hash: string): boolean {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return false;
  }
  const target = id ? document.getElementById(id) : null;
  if (!target || !root?.contains(target)) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

/** In-page links (a table of contents) scroll within the page instead of navigating. */
function followAnchor(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const link = (event.target as Element).closest?.('a[href^="#"]');
  const hash = link?.getAttribute('href');
  if (!hash) return;
  event.preventDefault();
  event.stopPropagation();
  if (scrollToAnchor(event.currentTarget, hash)) {
    window.history.replaceState(window.history.state, '', hash);
  }
}

/** One embedded board; readers who cannot see its team get a note instead of an error. */
export function WikiWhiteboard({ id, title }: { id: string; title: string }) {
  const { t } = useTranslation();
  const [board, setBoard] = useState<WhiteboardView | null>();

  useEffect(() => {
    let current = true;
    api
      .whiteboard(id)
      .then((view) => current && setBoard(view))
      .catch(() => current && setBoard(null));
    return () => {
      current = false;
    };
  }, [id]);

  return (
    <article
      aria-label={board?.title ?? title}
      className="overflow-hidden rounded-xl border border-line bg-card shadow-card"
    >
      <header className="flex flex-wrap items-center gap-2 gap-y-2 border-b border-line px-3 py-2 text-sm">
        <Shapes aria-hidden size={14} className="shrink-0 text-ink-muted" />
        <span className="truncate font-medium text-ink">{board?.title ?? title}</span>
        {board && <span className="text-xs text-ink-faint">{board.team.key}</span>}
        {board && (
          <Link
            href={`/whiteboards/${id}`}
            className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <Maximize2 aria-hidden size={12} />
            {t('whiteboards.open')}
          </Link>
        )}
      </header>
      {board === null ? (
        <p className="p-4 text-sm text-ink-muted">{t('wiki.boardUnavailable')}</p>
      ) : board ? (
        <div className="h-96">
          <LazyCanvas board={board} embedded />
        </div>
      ) : (
        <p className="p-4 text-sm text-ink-muted">{t('whiteboards.loading')}</p>
      )}
    </article>
  );
}
