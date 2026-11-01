import type { EmailTemplateView } from '@ordler/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { EmailTemplates } from './EmailTemplates.js';

afterEach(() => vi.unstubAllGlobals());

const builtIn = { subject: '{code} is your code', body: 'Use {code}.' };

function templates(ruCustom?: { subject: string; body: string }): EmailTemplateView[] {
  const locale = (custom?: { subject: string; body: string }) => ({
    ...(custom ?? builtIn),
    customized: Boolean(custom),
    default: builtIn,
  });
  return [
    {
      key: 'otp',
      variables: ['code', 'company', 'minutes'],
      required: ['code'],
      locales: { en: locale(), ru: locale(ruCustom), de: locale(), az: locale() },
    },
    {
      key: 'invite',
      variables: ['company', 'url', 'days'],
      required: ['url'],
      locales: { en: locale(), ru: locale(), de: locale(), az: locale() },
    },
  ];
}

describe('EmailTemplates', () => {
  it('shows the placeholders and saves the text for the chosen language', async () => {
    const custom = { subject: 'Код {code}', body: 'Ваш код {code}.' };
    const calls = mockApi({
      'GET /api/admin/mail/templates': () => ({ json: templates() }),
      'PUT /api/admin/mail/templates/otp/ru': () => ({ json: templates(custom) }),
    });
    await renderWithI18n(<EmailTemplates />);
    await userEvent.selectOptions(await screen.findByLabelText('Language'), 'ru');
    expect(screen.getByText('{minutes}')).toBeInTheDocument();
    expect(screen.getByText(/Required: \{code\}/)).toBeInTheDocument();

    const subject = screen.getByLabelText('Subject');
    await userEvent.clear(subject);
    await userEvent.type(subject, 'Код {{code}');
    const body = screen.getByLabelText('Text');
    await userEvent.clear(body);
    await userEvent.type(body, 'Ваш код {{code}.');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual(custom));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Русский · customized' })).toBeInTheDocument();
  });

  it('previews the unsaved text and shows template errors', async () => {
    mockApi({
      'GET /api/admin/mail/templates': () => ({ json: templates() }),
      'POST /api/admin/mail/templates/otp/en/preview': () => ({
        json: { subject: '482913 is your code', text: 'Use 482913.' },
      }),
      'PUT /api/admin/mail/templates/otp/en': () => ({
        status: 400,
        json: { error: 'template_missing_variable' },
      }),
    });
    await renderWithI18n(<EmailTemplates />);
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('482913 is your code')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(
      await screen.findByText('The template leaves out a required placeholder.'),
    ).toBeInTheDocument();
  });

  it('offers a reset only for customized text and restores the default', async () => {
    const calls = mockApi({
      'GET /api/admin/mail/templates': () => ({
        json: templates({ subject: 'Код {code}', body: '{code}' }),
      }),
      'DELETE /api/admin/mail/templates/otp/ru': () => ({ json: templates() }),
    });
    await renderWithI18n(<EmailTemplates />);
    await screen.findByLabelText('Subject');
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'ru');
    expect(screen.getByLabelText('Subject')).toHaveValue('Код {code}');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue(builtIn.subject));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
