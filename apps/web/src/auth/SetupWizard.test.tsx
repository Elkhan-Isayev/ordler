import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { SetupWizard } from './SetupWizard.js';

afterEach(() => vi.unstubAllGlobals());

async function fill(password = 'a-strong-password', confirm = password) {
  await userEvent.type(screen.getByLabelText('Company name'), 'Push30');
  await userEvent.type(screen.getByLabelText('Your name'), 'Ann Lee');
  await userEvent.type(screen.getByLabelText('Email'), 'ann@push30.test');
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Repeat password'), confirm);
}

describe('SetupWizard', () => {
  it('submits the workspace and owner, then completes', async () => {
    const calls = mockApi({ 'POST /api/setup': () => ({ status: 201, json: ME }) });
    const onComplete = vi.fn();
    await renderWithI18n(<SetupWizard initialLocale="en" onComplete={onComplete} />);
    await fill();
    await userEvent.selectOptions(screen.getByLabelText('Default language'), 'az');
    await userEvent.click(screen.getByRole('button', { name: 'İş sahəsini yarat' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(ME));
    expect(calls[0]).toEqual({
      method: 'POST',
      path: '/api/setup',
      body: {
        companyName: 'Push30',
        defaultLocale: 'az',
        owner: { name: 'Ann Lee', email: 'ann@push30.test', password: 'a-strong-password' },
      },
    });
  });

  it('switches the wizard language as the default language changes', async () => {
    await renderWithI18n(<SetupWizard initialLocale="en" onComplete={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Default language'), 'ru');
    expect(await screen.findByRole('heading', { name: 'Настройка Ordler' })).toBeInTheDocument();
  });

  it('checks password length and confirmation before calling the API', async () => {
    const calls = mockApi({});
    await renderWithI18n(<SetupWizard initialLocale="en" onComplete={vi.fn()} />);
    await fill('short');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The password is too short.');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'a-strong-password');
    await userEvent.clear(screen.getByLabelText('Repeat password'));
    await userEvent.type(screen.getByLabelText('Repeat password'), 'different-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The passwords do not match.');
    expect(calls).toHaveLength(0);
  });

  it('shows server errors', async () => {
    mockApi({ 'POST /api/setup': () => ({ status: 409, json: { error: 'setup_completed' } }) });
    await renderWithI18n(<SetupWizard initialLocale="en" onComplete={vi.fn()} />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ordler is already set up.');
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  });
});
