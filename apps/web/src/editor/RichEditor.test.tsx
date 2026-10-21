import type { AttachmentView } from '@ordler/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { RichEditor } from './RichEditor.js';

vi.mock('./mermaid.js', async (original) => ({
  ...(await original<typeof import('./mermaid.js')>()),
  renderDiagram: vi.fn(async (source: string) =>
    source.includes('broken')
      ? { error: 'Parse error' }
      : { svg: '<svg data-testid="diagram"></svg>' },
  ),
}));

const image: AttachmentView = {
  id: 'a1',
  url: '/api/attachments/a1/screen.png',
  filename: 'screen.png',
  contentType: 'image/png',
  size: 10,
  isImage: true,
};

const textbox = () => screen.getByRole('textbox', { name: 'Description' });

function attach(files: File[]) {
  const input = screen.getByLabelText('Attach files', { selector: 'input' });
  fireEvent.change(input, { target: { files } });
}

describe('RichEditor', () => {
  it('renders stored Markdown as rich text', async () => {
    await renderWithI18n(
      <RichEditor label="Description" value={'## Steps\n\n- restart\n- **check** the cable'} />,
    );
    expect(await screen.findByRole('heading', { name: 'Steps' })).toBeInTheDocument();
    expect(within(textbox()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('commits Markdown with attached images when focus leaves', async () => {
    const onCommit = vi.fn();
    await renderWithI18n(
      <RichEditor
        label="Description"
        value="Hello"
        onCommit={onCommit}
        onUpload={async () => image}
      />,
    );
    attach([new File(['png'], 'screen.png', { type: 'image/png' })]);
    await within(textbox()).findByRole('img', { name: 'screen.png' });
    fireEvent.blur(textbox());
    await waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
    expect(onCommit.mock.calls[0]![0]).toContain('![screen.png](/api/attachments/a1/screen.png)');
  });

  it('does not commit when nothing changed', async () => {
    const onCommit = vi.fn();
    await renderWithI18n(<RichEditor label="Description" value="Hello" onCommit={onCommit} />);
    fireEvent.focus(textbox());
    fireEvent.blur(textbox());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('uploads attached images and shows them inline', async () => {
    const onUpload = vi.fn(async () => image);
    await renderWithI18n(<RichEditor label="Description" value="" onUpload={onUpload} />);
    attach([new File(['png'], 'screen.png', { type: 'image/png' })]);
    const picture = await within(textbox()).findByRole('img', { name: 'screen.png' });
    expect(picture).toHaveAttribute('src', '/api/attachments/a1/screen.png');
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it('links other files', async () => {
    const pdf = {
      ...image,
      id: 'a2',
      url: '/api/attachments/a2/spec.pdf',
      filename: 'spec.pdf',
      isImage: false,
    };
    await renderWithI18n(<RichEditor label="Description" value="" onUpload={async () => pdf} />);
    attach([new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' })]);
    expect(await within(textbox()).findByRole('link', { name: 'spec.pdf' })).toHaveAttribute(
      'href',
      '/api/attachments/a2/spec.pdf',
    );
  });

  it('reports failed uploads', async () => {
    const onUploadError = vi.fn();
    await renderWithI18n(
      <RichEditor
        label="Description"
        value=""
        onUpload={async () => {
          throw new Error('too large');
        }}
        onUploadError={onUploadError}
      />,
    );
    attach([new File(['x'], 'big.bin')]);
    await waitFor(() => expect(onUploadError).toHaveBeenCalled());
  });

  it('inserts a Mermaid diagram and renders it', async () => {
    await renderWithI18n(<RichEditor label="Description" value="" />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert diagram (Mermaid)' }));
    expect(await screen.findByRole('img', { name: 'Diagram' })).toBeInTheDocument();
  });

  it('shows diagrams instead of their source when read-only', async () => {
    await renderWithI18n(
      <RichEditor
        label="Description"
        editable={false}
        value={'```mermaid\nflowchart LR\n  a --> b\n```'}
      />,
    );
    expect(await screen.findByRole('img', { name: 'Diagram' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(textbox()).toHaveAttribute('contenteditable', 'false');
    // No empty input area below read-only text.
    expect(textbox().closest('.ordler-prose')).toHaveClass('ordler-readonly');
  });

  it('explains diagram syntax errors while editing', async () => {
    await renderWithI18n(<RichEditor label="Description" value={'```mermaid\nbroken\n```'} />);
    expect(await screen.findByText('The diagram has a syntax error.')).toBeInTheDocument();
  });
});
