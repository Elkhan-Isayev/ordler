import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { mentionCandidates, RichEditor } from './RichEditor.js';

const PEOPLE = [
  { id: '01a13d37-d040-7000-b257-0000000000a1', name: 'Ann Lee' },
  { id: '01a13d37-d040-7000-b257-0000000000b2', name: 'Bob Stone' },
  { id: '01a13d37-d040-7000-b257-0000000000c3', name: 'Joanna Banks' },
];

describe('mentionCandidates', () => {
  it('prefers names starting with the query', () => {
    expect(mentionCandidates(PEOPLE, 'an').map((p) => p.name)).toEqual(['Ann Lee', 'Joanna Banks']);
    expect(mentionCandidates(PEOPLE, '').map((p) => p.name)).toHaveLength(3);
  });
});

describe('RichEditor mentions', () => {
  it('offers people after "@" and inserts a mention link', async () => {
    const onChange = vi.fn();
    await renderWithI18n(
      <RichEditor value="" label="Description" mentionables={PEOPLE} onChange={onChange} />,
    );
    const box = screen.getByRole('textbox', { name: 'Description' });
    // Tiptap exposes the editor on its DOM node; typing into contenteditable is not
    // possible in jsdom, so insert the text the way a keystroke would.
    const editor = (box as unknown as { editor: Editor }).editor;
    act(() => {
      editor.chain().focus('end').insertContent('Hi @bo').run();
    });
    expect(await screen.findByRole('listbox', { name: 'Mention someone' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Bob Stone']);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Bob Stone' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.stringContaining('[@Bob Stone](/people/01a13d37-d040-7000-b257-0000000000b2)'),
      ),
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('chooses with the keyboard and closes on Escape', async () => {
    const onChange = vi.fn();
    await renderWithI18n(
      <RichEditor value="" label="Description" mentionables={PEOPLE} onChange={onChange} />,
    );
    const box = screen.getByRole('textbox', { name: 'Description' });
    const editor = (box as unknown as { editor: Editor }).editor;
    act(() => {
      editor.chain().focus('end').insertContent('@').run();
    });
    await screen.findByRole('listbox');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('[@Bob Stone]')),
    );
    act(() => {
      editor.chain().focus('end').insertContent('@').run();
    });
    await screen.findByRole('listbox');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
