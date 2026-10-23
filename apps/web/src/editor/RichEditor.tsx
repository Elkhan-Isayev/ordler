import { mentionHref, type AttachmentView, type MemberRef } from '@ordler/shared';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlockView } from './MermaidBlock.js';
import { DIAGRAM_TEMPLATE } from './mermaid.js';

export type Uploader = (file: File) => Promise<AttachmentView>;

export interface RichEditorProps {
  /** Markdown; the stored format, readable by people, exports and agents. */
  value: string;
  editable?: boolean;
  placeholder?: string;
  label: string;
  /** Called with the Markdown when focus leaves the editor and the text changed. */
  onCommit?: (markdown: string) => void;
  /** Called with the Markdown on every change, for forms that read it on submit. */
  onChange?: (markdown: string) => void;
  /** Uploads pasted or dropped files; without it files are ignored. */
  onUpload?: Uploader | undefined;
  /** Shown while an upload fails, e.g. the file is too large. */
  onUploadError?: (error: unknown) => void;
  /** People offered after typing "@"; mentions notify them (SPEC §5.1). */
  mentionables?: MemberRef[] | undefined;
  className?: string;
}

/** An open "@" suggestion: what was typed after "@", where it starts, which row is picked. */
interface MentionState {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
  index: number;
}

const MENTION_QUERY = /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u;

/** People whose name contains the query, best (prefix) matches first. */
export function mentionCandidates(people: MemberRef[], query: string): MemberRef[] {
  const q = query.toLowerCase();
  return people
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)),
    )
    .slice(0, 8);
}

/**
 * Linear-style rich text (SPEC §5.1): Markdown shortcuts, images and files by paste or drop
 * (stored in PostgreSQL), and Mermaid diagrams in ```mermaid blocks.
 */
export function RichEditor({
  value,
  editable = true,
  placeholder,
  label,
  onCommit,
  onChange,
  onUpload,
  onUploadError,
  mentionables,
  className = '',
}: RichEditorProps) {
  const { t } = useTranslation();
  const committed = useRef(value);
  const uploader = useRef({ onUpload, onUploadError });
  uploader.current = { onUpload, onUploadError };
  const [uploading, setUploading] = useState(0);
  const [mention, setMention] = useState<MentionState>();
  // Key handling runs inside ProseMirror, which keeps the first closure: read through refs.
  const mentionRef = useRef<{ state: MentionState | undefined; people: MemberRef[] }>({
    state: undefined,
    people: [],
  });
  const candidates = mention ? mentionCandidates(mentionables ?? [], mention.query) : [];
  mentionRef.current = { state: mention, people: candidates };

  const editor = useEditor({
    editable,
    content: value,
    contentType: 'markdown',
    extensions: [
      StarterKit.configure({ codeBlock: false, link: { openOnClick: !editable, autolink: true } }),
      CodeBlock.extend({ addNodeView: () => ReactNodeViewRenderer(CodeBlockView) }),
      Image.configure({ inline: false }),
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    editorProps: {
      attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
      handlePaste: (_view, event) => insertFiles(event.clipboardData?.files),
      handleKeyDown: (_view, event) => {
        const { state, people } = mentionRef.current;
        if (!state || people.length === 0) return false;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setMention({ ...state, index: (state.index + step + people.length) % people.length });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          pickRef.current(people[state.index]!);
          return true;
        }
        if (event.key === 'Escape') {
          setMention(undefined);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => insertFiles((event as DragEvent).dataTransfer?.files),
    },
    onUpdate: ({ editor: current }) => {
      onChange?.(current.getMarkdown());
      findMention(current);
    },
    onSelectionUpdate: ({ editor: current }) => findMention(current),
    onBlur: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      if (markdown !== committed.current) {
        committed.current = markdown;
        onCommit?.(markdown);
      }
    },
  });

  /** Opens the "@" list when the text just before the cursor is "@" plus a name. */
  function findMention(current: Editor) {
    if (!mentionables?.length || !current.isEditable) return;
    const { $from, empty } = current.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
    const match = empty ? MENTION_QUERY.exec(before) : null;
    if (!match) {
      setMention(undefined);
      return;
    }
    const query = match[1]!;
    const from = $from.pos - query.length - 1;
    const coords = current.view.coordsAtPos(from);
    setMention((previous) => ({
      query,
      from,
      to: $from.pos,
      left: coords.left,
      top: coords.bottom + 4,
      index: previous?.query === query ? previous.index : 0,
    }));
  }

  /** Replaces "@query" with a linked "@Name" that the server recognises as a mention. */
  function pick(person: MemberRef) {
    const state = mentionRef.current.state;
    if (!editor || !state) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: state.from, to: state.to }, [
        {
          type: 'text',
          text: `@${person.name}`,
          marks: [{ type: 'link', attrs: { href: mentionHref(person.id) } }],
        },
        { type: 'text', text: ' ' },
      ])
      .unsetMark('link')
      .run();
    setMention(undefined);
  }
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // Another tab changed the text: show it unless this user is typing right now.
  useEffect(() => {
    if (!editor || editor.isFocused || value === committed.current) return;
    committed.current = value;
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  function insertFiles(files: FileList | null | undefined): boolean {
    const { onUpload: upload } = uploader.current;
    if (!editor || !upload || !files || files.length === 0) return false;
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      upload(file)
        .then((attachment) => insertAttachment(editor, attachment))
        .catch((error: unknown) => uploader.current.onUploadError?.(error))
        .finally(() => setUploading((n) => n - 1));
    }
    return true;
  }

  return (
    <div
      className={`ordler-editor flex flex-col rounded-lg border border-line bg-card ${className}`}
    >
      {editor && editable && (
        <Toolbar
          editor={editor}
          uploading={uploading > 0}
          onFiles={onUpload ? insertFiles : undefined}
        />
      )}
      <EditorContent
        editor={editor}
        // Read-only text (comments) takes only the space its content needs.
        className={`ordler-prose px-3 py-2 text-sm text-ink ${editable ? 'min-h-24' : 'ordler-readonly'}`}
      />
      {mention && candidates.length > 0 && (
        <ul
          role="listbox"
          aria-label={t('editor.mention')}
          style={{ left: mention.left, top: mention.top }}
          className="fixed z-50 w-56 rounded-lg border border-line bg-card p-1 shadow-lg"
        >
          {candidates.map((person, index) => (
            <li
              key={person.id}
              role="option"
              aria-selected={index === mention.index}
              // Keep focus in the editor while choosing.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm text-ink ${
                index === mention.index ? 'bg-hover' : ''
              }`}
            >
              {person.name}
            </li>
          ))}
        </ul>
      )}
      {uploading > 0 && (
        <p role="status" className="px-3 pb-2 text-xs text-ink-faint">
          {t('editor.uploading')}
        </p>
      )}
    </div>
  );
}

/** Images become inline pictures; other files become links to the stored attachment. */
export function insertAttachment(editor: Editor, attachment: AttachmentView): void {
  if (attachment.isImage) {
    editor.chain().focus().setImage({ src: attachment.url, alt: attachment.filename }).run();
  } else {
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: attachment.filename,
        marks: [{ type: 'link', attrs: { href: attachment.url } }],
      })
      .insertContent(' ')
      .run();
  }
}

function Toolbar({
  editor,
  uploading,
  onFiles,
}: {
  editor: Editor;
  uploading: boolean;
  onFiles?: ((files: FileList | null) => boolean) | undefined;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const chain = () => editor.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar')}
      className="flex flex-wrap gap-0.5 border-b border-line px-1 py-1"
    >
      <Tool
        label={t('editor.bold')}
        active={editor.isActive('bold')}
        onClick={() => chain().toggleBold().run()}
      >
        <b>B</b>
      </Tool>
      <Tool
        label={t('editor.italic')}
        active={editor.isActive('italic')}
        onClick={() => chain().toggleItalic().run()}
      >
        <i>I</i>
      </Tool>
      <Tool
        label={t('editor.heading')}
        active={editor.isActive('heading')}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        H
      </Tool>
      <Tool
        label={t('editor.bulletList')}
        active={editor.isActive('bulletList')}
        onClick={() => chain().toggleBulletList().run()}
      >
        •
      </Tool>
      <Tool
        label={t('editor.orderedList')}
        active={editor.isActive('orderedList')}
        onClick={() => chain().toggleOrderedList().run()}
      >
        1.
      </Tool>
      <Tool
        label={t('editor.quote')}
        active={editor.isActive('blockquote')}
        onClick={() => chain().toggleBlockquote().run()}
      >
        ❝
      </Tool>
      <Tool
        label={t('editor.code')}
        active={editor.isActive('codeBlock')}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        {'</>'}
      </Tool>
      <Tool
        label={t('editor.insertDiagram')}
        onClick={() =>
          chain()
            .insertContent({
              type: 'codeBlock',
              attrs: { language: 'mermaid' },
              content: [{ type: 'text', text: DIAGRAM_TEMPLATE }],
            })
            .run()
        }
      >
        ◇
      </Tool>
      {onFiles && (
        <>
          <Tool
            label={t('editor.attach')}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            📎
          </Tool>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label={t('editor.attach')}
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

function Tool({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the selection in the editor when clicking a tool.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`min-w-7 rounded px-1.5 py-0.5 text-xs ${
        active ? 'bg-hover text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink'
      } disabled:opacity-50`}
    >
      {children}
    </button>
  );
}
