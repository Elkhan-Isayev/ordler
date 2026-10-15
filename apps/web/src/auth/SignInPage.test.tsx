import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi } from '../test/api-mock.js';
import { renderWithI18n } from '../test/render.js';
import { SignInPage } from './SignInPage.js';

afterEach(() => vi.unstubAllGlobals());

const strategies =
  (...kinds: string[]) =>
  () => ({
    json: kinds.map((kind) => ({ kind, displayName: null })),
  });

describe('SignInPage', () => {
  it('renders only the enabled strategies', async () => {
    mockApi({ 'GET /api/auth/strategies': strategies('local', 'google') });
    await renderWithI18n(<SignInPage onSignedIn={vi.fn()} />);
    expect(await screen.findByRole('form', { name: 'Password' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/auth/google/start',
    );
    expect(screen.queryByRole('form', { name: 'Email me a sign-in code' })).not.toBeInTheDocument();
  });

  it('signs in with a password', async () => {
    const calls = mockApi({
      'GET /api/auth/strategies': strategies('local'),
      'POST /api/auth/password': () => ({ json: ME }),
    });
    const onSignedIn = vi.fn();
    await renderWithI18n(<SignInPage onSignedIn={onSignedIn} />);
    const form = await screen.findByRole('form', { name: 'Password' });
    await userEvent.type(within(form).getByLabelText('Email'), 'ann@push30.test');
    await userEvent.type(within(form).getByLabelText('Password'), 'secret-password');
    await userEvent.click(within(form).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(ME));
    expect(calls.at(-1)!.body).toEqual({ email: 'ann@push30.test', password: 'secret-password' });
  });

  it('shows a translated error for wrong credentials', async () => {
    mockApi({
      'GET /api/auth/strategies': strategies('local'),
      'POST /api/auth/password': () => ({ status: 401, json: { error: 'invalid_credentials' } }),
    });
    await renderWithI18n(<SignInPage onSignedIn={vi.fn()} />, 'ru');
    const form = await screen.findByRole('form', { name: 'Пароль' });
    await userEvent.type(within(form).getByLabelText('Эл. почта'), 'ann@push30.test');
    await userEvent.type(within(form).getByLabelText('Пароль'), 'wrong-password');
    await userEvent.click(within(form).getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверная почта или пароль.');
  });

  it('signs in with an emailed code in two steps', async () => {
    const calls = mockApi({
      'GET /api/auth/strategies': strategies('email_otp'),
      'POST /api/auth/otp/request': () => ({ status: 202, json: { status: 'accepted' } }),
      'POST /api/auth/otp/verify': () => ({ json: ME }),
    });
    const onSignedIn = vi.fn();
    await renderWithI18n(<SignInPage onSignedIn={onSignedIn} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'ann@push30.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }));

    expect(await screen.findByText(/ann@push30.test can sign in/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Sign-in code'), '042917');
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(ME));
    expect(calls.at(-1)!.body).toEqual({ email: 'ann@push30.test', code: '042917' });
  });

  it('lets the user go back and use another email', async () => {
    mockApi({
      'GET /api/auth/strategies': strategies('email_otp'),
      'POST /api/auth/otp/request': () => ({ status: 202, json: {} }),
    });
    await renderWithI18n(<SignInPage onSignedIn={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText('Email'), 'ann@push30.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use another email' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows the error the Google callback reported', async () => {
    mockApi({ 'GET /api/auth/strategies': strategies('google') });
    await renderWithI18n(<SignInPage initialError="domain_not_allowed" onSignedIn={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Accounts from this email domain are not allowed.',
    );
  });

  it('treats unknown error codes generically', async () => {
    mockApi({ 'GET /api/auth/strategies': strategies('local') });
    await renderWithI18n(<SignInPage initialError="<script>" onSignedIn={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('explains when no strategy is available', async () => {
    mockApi({ 'GET /api/auth/strategies': strategies() });
    await renderWithI18n(<SignInPage onSignedIn={vi.fn()} />);
    expect(await screen.findByText(/Sign-in is not available/)).toBeInTheDocument();
  });
});
