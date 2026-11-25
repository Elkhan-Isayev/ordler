import { Clapperboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HELP_SECTIONS, HELP_TOPICS, type HelpTopic } from './topics.js';

/**
 * Help: short silent screen recordings, one per task, so the page reads the same in every
 * language. Clips are recorded by scripts/help-clips against a demo workspace.
 */
export function HelpPage() {
  const { t } = useTranslation();

  // /help#<topic> links (e.g. from a "?" next to a form) land on that clip.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-line px-4 py-3">
        <h1 className="text-sm font-semibold text-ink">{t('help.title')}</h1>
      </header>
      <div className="flex flex-col gap-8 p-4">
        {HELP_SECTIONS.map((section) => (
          <section
            key={section}
            aria-labelledby={`help-${section}`}
            className="flex flex-col gap-3"
          >
            <h2 id={`help-${section}`} className="text-xs font-medium text-ink-faint">
              {t(`help.sections.${section}`)}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {HELP_TOPICS.filter((topic) => topic.section === section).map((topic) => (
                <TopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function TopicCard({ topic }: { topic: HelpTopic }) {
  const { t } = useTranslation();
  // A clip listed but missing from this build falls back to the placeholder.
  const [broken, setBroken] = useState(false);
  const title = t(`help.topics.${topic.id}`);
  const Icon = topic.icon;
  return (
    <article
      id={topic.id}
      aria-label={title}
      className="flex scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-card"
    >
      {topic.clip && !broken ? (
        <video
          src={topic.clip}
          aria-label={title}
          // Behaves like a GIF: silent, looping, starts on its own; controls allow pause and fullscreen.
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="metadata"
          onError={() => setBroken(true)}
          className="aspect-[16/10] w-full bg-hover object-contain"
        />
      ) : (
        <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-hover text-ink-faint">
          <Clapperboard aria-hidden size={28} strokeWidth={1.5} />
          <span className="text-xs">{t('help.comingSoon')}</span>
        </div>
      )}
      <h3 className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-ink">
        <Icon aria-hidden size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />
        {title}
      </h3>
    </article>
  );
}
