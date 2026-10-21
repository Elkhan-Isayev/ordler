import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './ui.js';

describe('Avatar', () => {
  it.each([
    ['Ann Lee', 'AL'],
    ['Алия (CS)', 'АC'],
    ['(admin) Bob', 'AB'],
    ['Owner', 'O'],
  ])('shows initials of %s', (name, initials) => {
    render(<Avatar member={{ id: 'm', name }} />);
    expect(screen.getByTitle(name)).toHaveTextContent(initials);
  });
});
