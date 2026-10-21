import type { AttachmentView } from '@ordler/shared';
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
  className?: string;
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
  className = '',
}: RichEditorProps) {
  const { t } = useTranslation();
  const committed = useRef(value);
  const uploader = useRef({ onUpload, onUploadError });
  uploader.current = { onUpload, onUploadError };
  const [uploading, setUploading] = useState(0);

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
      handleDrop: (_view, event) => insertFiles((event as DragEvent).dataTransfer?.files),
    },
    onUpdate: ({ editor: current }) => onChange?.(current.getMarkdown()),
    onBlur: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      if (markdown !== committed.current) {
        committed.current = markdown;
        onCommit?.(markdown);
      }
    },
  });

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
      className={`ordler-editor flex flex-col rounded-md border border-line bg-surface ${className}`}
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
