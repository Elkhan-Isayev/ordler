import { AUTH_STRATEGY_KINDS } from '@ordler/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StrategyIcon } from './provider-icons.js';

describe('StrategyIcon', () => {
  it.each(AUTH_STRATEGY_KINDS)('draws a decorative icon for %s', (kind) => {
    const { container } = render(<StrategyIcon kind={kind} size={16} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-icon', kind);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '16');
  });

  it('keeps the brand colours of the Google and Microsoft logos', () => {
    const fills = (kind: 'google' | 'microsoft') =>
      [...render(<StrategyIcon kind={kind} />).container.querySelectorAll('[fill]')].map((n) =>
        n.getAttribute('fill'),
      );
    expect(fills('google')).toEqual(['#EA4335', '#4285F4', '#FBBC05', '#34A853']);
    expect(fills('microsoft')).toEqual(['#F25022', '#7FBA00', '#00A4EF', '#FFB900']);
  });
});
