import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS, TEMPLATE_LABELS, templateSkeleton } from './templates.js';

describe('templateSkeleton', () => {
  it('builds every template around the given centre with the given labels', () => {
    for (const key of TEMPLATE_KEYS) {
      const labels = Object.fromEntries(TEMPLATE_LABELS[key].map((name) => [name, `«${name}»`]));
      const skeleton = templateSkeleton(key, labels, { x: 1000, y: 1000 });
      expect(skeleton.length, key).toBeGreaterThan(0);
      for (const item of skeleton) {
        expect(Math.abs(Number(item.x) - 1000), key).toBeLessThan(800);
      }
      const texts = JSON.stringify(skeleton);
      for (const name of TEMPLATE_LABELS[key])
        expect(texts, `${key}.${name}`).toContain(`«${name}»`);
    }
  });

  it('binds flowchart arrows to the shapes they connect', () => {
    const skeleton = templateSkeleton('flowchart', {}, { x: 0, y: 0 });
    const ids = new Set(skeleton.map((s) => s.id).filter(Boolean));
    for (const arrow of skeleton.filter((s) => s.type === 'arrow')) {
      expect(ids.has((arrow.start as { id: string }).id)).toBe(true);
      expect(ids.has((arrow.end as { id: string }).id)).toBe(true);
    }
  });
});
