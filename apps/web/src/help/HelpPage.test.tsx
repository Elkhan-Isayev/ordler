import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Locale } from '@ordler/shared';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/index.js';
import { HelpPage } from './HelpPage.js';
import { HELP_TOPICS } from './topics.js';

async function renderHelp(locale: Locale = 'en') {
  const i18n = await createI18n(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <HelpPage />
    </I18nextProvider>,
  );
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('HelpPage', () => {
  it('groups every topic under its section', async () => {
    await renderHelp();
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    const requests = screen.getByRole('region', { name: 'Requests and approvals' });
    expect(
      within(requests).getByRole('article', { name: 'Send a request to another department' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(HELP_TOPICS.length);
  });

  it('plays a recorded clip silently on a loop, like a GIF', async () => {
    await renderHelp();
    const card = screen.getByRole('article', { name: 'Approve or reject a request' });
    const video = card.querySelector('video')!;
    expect(video).toHaveAttribute('src', '/help/approval-decide.webm');
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('autoplay');
  });

  it('has a recorded clip for every topic', async () => {
    await renderHelp();
    for (const topic of HELP_TOPICS) {
      expect(document.getElementById(topic.id)?.querySelector('video')).toHaveAttribute(
        'src',
        `/help/${topic.id}.webm`,
      );
      // The file must ship with the build, or the card silently shows the placeholder.
      // Vitest runs from apps/web, the Vite root that serves public/.
      expect(existsSync(join(process.cwd(), 'public', topic.clip!)), topic.id).toBe(true);
    }
  });

  it('falls back to the placeholder when a clip is missing from the build', async () => {
    await renderHelp();
    const card = screen.getByRole('article', { name: 'Write a wiki page' });
    fireEvent.error(card.querySelector('video')!);
    expect(card.querySelector('video')).toBeNull();
    expect(within(card).getByText('Video coming soon')).toBeInTheDocument();
  });

  it('gives each topic an anchor so other screens can link to it', async () => {
    await renderHelp();
    for (const topic of HELP_TOPICS) expect(document.getElementById(topic.id)).not.toBeNull();
  });

  it('speaks the member language', async () => {
    await renderHelp('ru');
    expect(screen.getByRole('heading', { level: 1, name: 'Справка' })).toBeInTheDocument();
    expect(
      screen.getByRole('article', { name: 'Отправить запрос в другой департамент' }),
    ).toBeInTheDocument();
  });
});
