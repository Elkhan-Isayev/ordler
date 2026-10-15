import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Link, navigate, usePathname } from './router.js';

function Probe() {
  const path = usePathname();
  return (
    <div>
      <span data-testid="path">{path}</span>
      <Link href="/admin/members">Members</Link>
    </div>
  );
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('router', () => {
  it('navigates in-app on link clicks', async () => {
    render(<Probe />);
    await userEvent.click(screen.getByRole('link', { name: 'Members' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/members');
    expect(window.location.pathname).toBe('/admin/members');
  });

  it('follows programmatic navigation and the back button', async () => {
    render(<Probe />);
    act(() => navigate('/admin/updates'));
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/updates');
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('leaves modified clicks to the browser', async () => {
    render(<Probe />);
    const link = screen.getByRole('link', { name: 'Members' });
    link.addEventListener('click', (event) => event.preventDefault());
    await userEvent.keyboard('{Meta>}');
    await userEvent.click(link);
    await userEvent.keyboard('{/Meta}');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });
});
