import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render.js';
import { WikiContent } from './WikiContent.js';

const PAGE = [
  '- [Partner selection](#выбор-партнёра)',
  '- [Conclusion](#заключение)',
  '',
  '## Выбор партнёра',
  '',
  'Text',
  '',
  '## Notes',
  '',
  '## Notes',
  '',
  '## Заключение',
].join('\n');

const scrolled = vi.fn<(this: Element) => void>();

beforeEach(() => {
  // jsdom has no layout, so record which element was asked to scroll.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.call(this);
  };
  scrolled.mockClear();
  window.history.replaceState(null, '', '/wiki/page/p1');
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const lastScrolled = () => scrolled.mock.contexts.at(-1) as Element | undefined;

describe('WikiContent anchors', () => {
  it('gives headings GitHub-style ids, numbering repeats', async () => {
    await renderWithI18n(<WikiContent content={PAGE} label="Page" />);
    expect(await screen.findByRole('heading', { name: 'Выбор партнёра' })).toHaveAttribute(
      'id',
      'выбор-партнёра',
    );
    expect(screen.getAllByRole('heading', { name: 'Notes' }).map((h) => h.id)).toEqual([
      'notes',
      'notes-1',
    ]);
  });

  it('scrolls to the heading a table of contents link names, without leaving the page', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await renderWithI18n(<WikiContent content={PAGE} label="Page" />);
    await userEvent.click(await screen.findByRole('link', { name: 'Conclusion' }));
    expect(lastScrolled()).toBe(screen.getByRole('heading', { name: 'Заключение' }));
    expect(decodeURIComponent(window.location.hash)).toBe('#заключение');
    expect(window.location.pathname).toBe('/wiki/page/p1');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('leaves the address alone when no heading matches', async () => {
    await renderWithI18n(<WikiContent content={'[Gone](#missing)\n\n## Here'} label="Page" />);
    await userEvent.click(await screen.findByRole('link', { name: 'Gone' }));
    expect(scrolled).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('scrolls to the heading in the address once the page renders', async () => {
    window.history.replaceState(null, '', `/wiki/page/p1#${encodeURIComponent('заключение')}`);
    await renderWithI18n(<WikiContent content={PAGE} label="Page" />);
    await waitFor(() =>
      expect(lastScrolled()).toBe(screen.getByRole('heading', { name: 'Заключение' })),
    );
  });
});
