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

  // The editor binds arrows but keeps their geometry; without explicit points every arrow
  // became a 100px horizontal stub beside the shapes.
  it.each(['flowchart', 'mindmap'] as const)(
    'draws %s arrows from one shape to the other',
    (key) => {
      const skeleton = templateSkeleton(key, {}, { x: 500, y: 500 });
      const byId = new Map(skeleton.map((s) => [s.id, s]));
      const near = (shape: Record<string, unknown>, p: { x: number; y: number }) => {
        const [x, y, w, h] = [shape.x, shape.y, shape.width, shape.height].map(Number);
        return p.x >= x! - 12 && p.x <= x! + w! + 12 && p.y >= y! - 12 && p.y <= y! + h! + 12;
      };
      const arrows = skeleton.filter((s) => s.type === 'arrow');
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) {
        const points = arrow.points as [number, number][] | undefined;
        expect(points, 'explicit points').toBeDefined();
        const [dx, dy] = points!.at(-1)!;
        const from = { x: Number(arrow.x), y: Number(arrow.y) };
        const to = { x: from.x + dx, y: from.y + dy };
        const start = byId.get((arrow.start as { id: string }).id)!;
        const end = byId.get((arrow.end as { id: string }).id)!;
        expect(near(start, from), `${String(start.id)} → start`).toBe(true);
        expect(near(end, to), `${String(end.id)} ← end`).toBe(true);
      }
    },
  );
});
