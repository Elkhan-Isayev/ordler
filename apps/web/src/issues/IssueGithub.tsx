import type { GithubLinkView, IssueGithubView } from '@ordler/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { copyText } from '../components/clipboard.js';

/** Linked GitHub items and the suggested branch name; refetched when the issue changes. */
export function useIssueGithub(identifier: string, version: string): IssueGithubView | undefined {
  const [view, setView] = useState<IssueGithubView>();
  useEffect(() => {
    let live = true;
    api.issueGithub(identifier).then(
      (next) => live && setView(next),
      // Links are extra: the issue page works without them.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [identifier, version]);
  return view;
}

/** Linear-style "Copy branch name": `<handle>/<identifier>-<short-title>`. */
export function CopyBranchButton({ branchName }: { branchName: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        className="rounded-md p-1 text-ink-muted hover:bg-hover hover:text-ink"
        aria-label={t('issues.github.copyBranch')}
        title={`${t('issues.github.copyBranch')}: ${branchName}`}
        onClick={() => void copyText(branchName).then((ok) => ok && setCopied(true))}
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="4.5" cy="3.5" r="1.5" />
          <circle cx="4.5" cy="12.5" r="1.5" />
          <circle cx="11.5" cy="5.5" r="1.5" />
          <path d="M4.5 5v6M11.5 7c0 2.5-2 3.5-7 4" />
        </svg>
      </button>
      <span role="status" className="text-xs text-ink-muted">
        {copied && t('issues.github.copiedBranch')}
      </span>
    </span>
  );
}

const STATE_CLASS: Record<string, string> = {
  open: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  draft: 'bg-hover text-ink-muted',
  merged: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  closed: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

function label(link: GithubLinkView): string {
  if (link.kind === 'pull_request') return `${link.repository}#${link.ref}`;
  if (link.kind === 'commit') return `${link.repository}@${link.ref.slice(0, 7)}`;
  return `${link.repository}:${link.ref}`;
}

/** Branches, pull requests and commits that mention this issue (ADR 0019). */
export function IssueGithubLinks({ links }: { links: GithubLinkView[] }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  const order = ['pull_request', 'branch', 'commit'] as const;
  return (
    <section aria-label={t('issues.github.title')} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">{t('issues.github.title')}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {order.flatMap((kind) =>
          links
            .filter((link) => link.kind === kind)
            .map((link) => (
              <li key={link.id} className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-xs text-ink-faint">
                  {t(`issues.github.kind.${link.kind}`)}
                </span>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono text-xs text-accent hover:underline"
                >
                  {label(link)}
                </a>
                {link.title && <span className="truncate text-ink-muted">{link.title}</span>}
                {link.state && (
                  <span
                    className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs ${STATE_CLASS[link.state]}`}
                  >
                    {t(`issues.github.state.${link.state}`)}
                  </span>
                )}
              </li>
            )),
        )}
      </ul>
    </section>
  );
}
