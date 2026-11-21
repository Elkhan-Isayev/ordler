import {
  WIKI_RELATION_TARGETS,
  WIKI_RELATION_TYPES,
  type WikiRelationTarget,
  type WikiRelationType,
  type WikiRelationView,
} from '@ordler/shared';
import { CircleDot, FileText, Inbox, Network, Shapes, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { Link } from '../router.js';

const KIND_ICONS: Record<WikiRelationTarget, typeof FileText> = {
  wiki_page: FileText,
  issue: CircleDot,
  request: Inbox,
  whiteboard: Shapes,
};

/**
 * The relations of a page (ADR 0018): typed ones people or agents added, and links written in
 * the text, in both directions. Editors add and remove typed relations here.
 */
export function WikiRelations({
  pageId,
  departmentId,
  canEdit,
  relations,
  titles,
  onChange,
}: {
  pageId: string;
  departmentId: string;
  canEdit: boolean;
  relations: WikiRelationView[];
  /** Page titles of the space, offered while typing a target. */
  titles: string[];
  onChange: (relations: WikiRelationView[]) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<WikiRelationTarget>('wiki_page');
  const [target, setTarget] = useState('');
  const [type, setType] = useState<WikiRelationType>('related');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onChange(
        await api.addWikiRelation(pageId, { targetKind: kind, target: target.trim(), type }),
      );
      setTarget('');
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(undefined);
    try {
      await api.removeWikiRelation(id);
      onChange(relations.filter((r) => r.id !== id));
    } catch (failure) {
      setError(errorKey(failure));
    }
  }

  return (
    <section
      aria-label={t('wiki.relations.title')}
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      <header className="flex flex-wrap items-center gap-2 gap-y-2">
        <h2 className="text-sm font-semibold text-ink">{t('wiki.relations.title')}</h2>
        <Link
          href={`/wiki/map/${departmentId}`}
          className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Network aria-hidden size={12} />
          {t('wiki.map.open')}
        </Link>
      </header>
      {relations.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('wiki.relations.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {relations.map((r) => {
            const Icon = KIND_ICONS[r.node.kind];
            return (
              <li
                key={`${r.direction}:${r.origin}:${r.id ?? r.node.kind + r.node.ref}`}
                className="flex items-center gap-2 text-sm"
              >
                <span className="w-28 shrink-0 text-xs text-ink-muted">
                  {t(`wiki.relations.${r.direction}.${r.type}`)}
                </span>
                <Icon aria-hidden size={14} className="shrink-0 text-ink-faint" />
                <Link href={r.node.href} className="truncate text-ink hover:underline">
                  {r.node.label}
                </Link>
                {r.node.department && (
                  <span className="shrink-0 text-xs text-ink-faint">{r.node.department.name}</span>
                )}
                {r.origin === 'link' && (
                  <span className="shrink-0 text-xs text-ink-faint">
                    {t('wiki.relations.fromText')}
                  </span>
                )}
                {r.note && <span className="truncate text-xs text-ink-muted">{r.note}</span>}
                {r.canRemove && r.id && (
                  <button
                    type="button"
                    aria-label={t('wiki.relations.remove', { label: r.node.label })}
                    className={`${ghostButtonClass} ml-auto`}
                    onClick={() => void remove(r.id!)}
                  >
                    <X aria-hidden size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('wiki.relations.type')}
            value={type}
            onChange={(event) => setType(event.target.value as WikiRelationType)}
            className={selectClass}
          >
            {WIKI_RELATION_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`wiki.relations.out.${value}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('wiki.relations.kind')}
            value={kind}
            onChange={(event) => setKind(event.target.value as WikiRelationTarget)}
            className={selectClass}
          >
            {WIKI_RELATION_TARGETS.map((value) => (
              <option key={value} value={value}>
                {t(`wiki.relations.kinds.${value}`)}
              </option>
            ))}
          </select>
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            aria-label={t('wiki.relations.target')}
            placeholder={t(`wiki.relations.placeholder.${kind}`)}
            list={kind === 'wiki_page' ? 'wiki-relation-titles' : undefined}
            maxLength={200}
            className={`${inputClass} min-w-0 basis-full sm:basis-48 flex-1`}
          />
          <datalist id="wiki-relation-titles">
            {titles.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>
          <button type="submit" className={buttonClass} disabled={busy || !target.trim()}>
            {t('wiki.relations.add')}
          </button>
        </form>
      )}
      {canEdit && <p className="text-xs text-ink-faint">{t('wiki.relations.hint')}</p>}
      {error && <FormError message={t(error)} />}
    </section>
  );
}
