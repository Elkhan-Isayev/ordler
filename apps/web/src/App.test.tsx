import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { ME } from './test/api-mock.js';
import { renderWithI18n } from './test/render.js';

describe('App', () => {
  it('shows the workspace, the member’s departments and the welcome screen', async () => {
    await renderWithI18n(<App me={ME} onSignOut={vi.fn()} />, 'de');
    expect(screen.getByRole('navigation', { name: 'Push30' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /IT/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Willkommen bei Ordler' })).toBeInTheDocument();
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
  });

  it('signs out from the sidebar', async () => {
    const onSignOut = vi.fn();
    await renderWithI18n(<App me={ME} onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
