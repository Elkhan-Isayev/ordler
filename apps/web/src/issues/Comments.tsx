import type { CommentView, MemberRef } from '@ordler/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, ghostButtonClass } from '../admin/common.js';
import { RichEditor, type Uploader } from '../editor/RichEditor.js';
import { Avatar } from './ui.js';

export function formatWhen(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** One comment: rendered Markdown, with edit and delete for those allowed. */
export function CommentItem({
  comment,
  onEdit,
  onDelete,
  onUpload,
  mentionables,
}: {
  comment: CommentView;
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onUpload?: Uploader | undefined;
  mentionables?: MemberRef[] | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? '');
  const author = comment.author?.name ?? t('issues.someone');

  return (
    <article
      aria-label={t('comments.by', { author })}
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <header className="flex items-center gap-2 text-xs text-ink-faint">
        <Avatar member={comment.author} />
        <span className="font-medium text-ink">{author}</span>
        <span>{formatWhen(comment.createdAt, i18n.language)}</span>
        {comment.edited && !comment.deleted && <span>· {t('comments.edited')}</span>}
        {!editing && (comment.canEdit || comment.canDelete) && (
          <span className="ml-auto flex gap-1">
            {comment.canEdit && (
              <button type="button" className={ghostButtonClass} onClick={() => setEditing(true)}>
                {t('comments.edit')}
              </button>
            )}
            {comment.canDelete && (
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => {
                  if (window.confirm(t('comments.confirmDelete'))) void onDelete();
                }}
              >
                {t('comments.delete')}
              </button>
            )}
          </span>
        )}
      </header>
      {comment.deleted ? (
        <p className="text-sm text-ink-faint italic">{t('comments.deleted')}</p>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <RichEditor
            value={comment.body ?? ''}
            label={t('comments.edit')}
            onChange={setDraft}
            onUpload={onUpload}
            mentionables={mentionables}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={!draft.trim()}
              onClick={async () => {
                if (await onEdit(draft)) setEditing(false);
              }}
            >
              {t('comments.save')}
            </button>
            <button type="button" className={ghostButtonClass} onClick={() => setEditing(false)}>
              {t('issues.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <RichEditor
          value={comment.body ?? ''}
          editable={false}
          label={t('comments.by', { author })}
          className="border-0"
        />
      )}
    </article>
  );
}

/** New comment box; Ctrl/Cmd+Enter sends. Remounts after sending to start empty. */
export function CommentComposer({
  onSend,
  onUpload,
  mentionables,
  onUploadError,
}: {
  onSend: (body: string) => Promise<boolean>;
  onUpload?: Uploader | undefined;
  mentionables?: MemberRef[] | undefined;
  onUploadError?: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [round, setRound] = useState(0);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    const ok = await onSend(draft);
    setSending(false);
    if (ok) {
      setDraft('');
      setRound((n) => n + 1);
    }
  }

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void send();
        }
      }}
    >
      <RichEditor
        key={round}
        value=""
        label={t('comments.new')}
        placeholder={t('comments.placeholder')}
        onChange={setDraft}
        onUpload={onUpload}
        mentionables={mentionables}
        onUploadError={onUploadError}
      />
      <div className="flex justify-end">
        <button
          type="button"
          className={buttonClass}
          disabled={!draft.trim() || sending}
          onClick={() => void send()}
        >
          {t('comments.send')}
        </button>
      </div>
    </div>
  );
}
