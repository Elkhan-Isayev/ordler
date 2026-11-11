import type { WhiteboardElement } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import { buildDiagram, describeBoard, DiagramError } from './diagram.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- elements carry many untyped editor fields
type El = WhiteboardElement & Record<string, any>;
const byId = (elements: WhiteboardElement[]) => new Map((elements as El[]).map((e) => [e.id, e]));

describe('buildDiagram', () => {
  it('lays out a flow top-down with labelled shapes bound to arrows', () => {
    const elements = buildDiagram(
      {
        nodes: [
          { id: 'start', label: 'Request received', shape: 'ellipse', color: 'green' },
          { id: 'check', label: 'Approved?', shape: 'diamond' },
          { id: 'done', label: 'Provision laptop' },
        ],
        edges: [
          { from: 'start', to: 'check' },
          { from: 'check', to: 'done', label: 'yes' },
        ],
      },
      [],
    ) as El[];
    const map = byId(elements);
    const [start, check, done] = ['start', 'check', 'done'].map((id) => map.get(id)!);

    expect(start).toMatchObject({ type: 'ellipse', backgroundColor: '#b2f2bb', version: 1 });
    expect(check!.type).toBe('diamond');
    expect(done!.type).toBe('rectangle');
    // Each rank sits below the previous one.
    expect(check!.y).toBeGreaterThan(start!.y + start!.height);
    expect(done!.y).toBeGreaterThan(check!.y + check!.height);

    const label = elements.find((e) => e.type === 'text' && e.containerId === 'done')!;
    expect(label).toMatchObject({ text: 'Provision laptop', textAlign: 'center' });
    expect(done!.boundElements).toContainEqual({ id: label.id, type: 'text' });

    const arrows = elements.filter((e) => e.type === 'arrow');
    expect(arrows).toHaveLength(2);
    expect(arrows[1]).toMatchObject({
      startBinding: { elementId: 'check' },
      endBinding: { elementId: 'done' },
      endArrowhead: 'arrow',
    });
    expect(check!.boundElements).toContainEqual({ id: arrows[1]!.id, type: 'arrow' });
    const arrowLabel = elements.find((e) => e.containerId === arrows[1]!.id)!;
    expect(arrowLabel.text).toBe('yes');

    // Fractional indices are strictly increasing in creation order.
    const indices = elements.map((e) => e.index as string);
    expect([...indices].sort()).toEqual(indices);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('lays out left to right and keeps explicit positions', () => {
    const elements = buildDiagram(
      {
        direction: 'right',
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'pinned', label: 'Pinned', x: 500, y: -300 },
        ],
        edges: [{ from: 'a', to: 'b', style: 'dashed' }],
      },
      [],
    );
    const map = byId(elements);
    expect(map.get('b')!.x).toBeGreaterThan(map.get('a')!.x + map.get('a')!.width);
    expect(map.get('pinned')).toMatchObject({ x: 500, y: -300 });
    expect(elements.find((e) => e.type === 'arrow')).toMatchObject({ strokeStyle: 'dashed' });
  });

  it('places new nodes right of the board and connects to shapes already on it', () => {
    const existing = [
      {
        id: 'old',
        type: 'rectangle',
        version: 3,
        versionNonce: 5,
        isDeleted: false,
        x: 0,
        y: 40,
        width: 300,
        height: 80,
        index: 'a5',
        boundElements: null,
      },
      {
        id: 'gone',
        type: 'rectangle',
        version: 2,
        versionNonce: 1,
        isDeleted: true,
        x: 5000,
        y: 0,
        width: 10,
        height: 10,
        index: 'a6',
      },
    ] as WhiteboardElement[];
    const elements = buildDiagram(
      {
        nodes: [{ id: 'old', label: 'Same id as an existing shape' }],
        edges: [{ from: 'old', to: 'old' }],
      },
      existing,
    ) as El[];

    const shape = elements.find((e) => e.type === 'rectangle' && e.id !== 'old')!;
    // The agent's id collided with a stored one, so the node got a fresh id.
    expect(shape.x).toBeGreaterThanOrEqual(500);
    expect(shape.y).toBe(40);
    expect(elements.every((e) => (e.index as string) > 'a5')).toBe(true);

    const linked = buildDiagram(
      { nodes: [{ id: 'n', label: 'New' }], edges: [{ from: 'old', to: 'n' }] },
      existing,
    ) as El[];
    const touched = linked.find((e) => e.id === 'old')!;
    const arrow = linked.find((e) => e.type === 'arrow')!;
    expect(touched).toMatchObject({ version: 4, boundElements: [{ id: arrow.id, type: 'arrow' }] });
    expect(touched.versionNonce).not.toBe(5);
  });

  it('refuses edges to unknown nodes and duplicate node ids', () => {
    expect(() =>
      buildDiagram({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'b' }] }, []),
    ).toThrow(DiagramError);
    expect(() => buildDiagram({ nodes: [{ id: 'a' }, { id: 'a' }] }, [])).toThrow(DiagramError);
  });

  it('survives cycles and makes sticky notes yellow', () => {
    const elements = buildDiagram(
      {
        nodes: [
          { id: 'x', label: 'Idea', shape: 'sticky' },
          { id: 'y', label: 'Feedback' },
        ],
        edges: [
          { from: 'x', to: 'y' },
          { from: 'y', to: 'x' },
        ],
      },
      [],
    );
    expect(byId(elements).get('x')).toMatchObject({
      type: 'rectangle',
      backgroundColor: '#ffec99',
      width: 200,
    });
    const long = buildDiagram(
      { nodes: [{ id: 's', label: 'Check the provider SLA', shape: 'sticky' }] },
      [],
    );
    const note = long.find((e) => e.type === 'text') as El;
    // Text inside a sticky wraps to fit the square note.
    expect(note.text).toBe('Check the\nprovider SLA');
    expect(note.width).toBeLessThan(200);
  });
});

describe('describeBoard', () => {
  it('reads shapes, labels, connectors and loose text back', () => {
    const built = buildDiagram(
      {
        nodes: [
          { id: 'a', label: 'Client' },
          { id: 'b', label: 'API', color: 'blue' },
          { id: 'note', label: 'TLS everywhere', shape: 'text' },
        ],
        edges: [{ from: 'a', to: 'b', label: 'HTTPS' }],
      },
      [],
    );
    const described = describeBoard([
      ...built,
      { id: 'erased', type: 'rectangle', version: 2, versionNonce: 1, isDeleted: true },
      { id: 'scribble', type: 'freedraw', version: 1, versionNonce: 1, isDeleted: false },
    ] as WhiteboardElement[]);
    expect(described.shapes.map((s) => [s.id, s.label])).toEqual([
      ['a', 'Client'],
      ['b', 'API'],
    ]);
    expect(described.shapes[1]!.color).toBe('#a5d8ff');
    expect(described.connectors).toEqual([
      { id: expect.any(String), from: 'a', to: 'b', label: 'HTTPS' },
    ]);
    expect(described.texts).toMatchObject([{ id: 'note', text: 'TLS everywhere' }]);
    expect(described.drawings).toBe(1);
  });
});
