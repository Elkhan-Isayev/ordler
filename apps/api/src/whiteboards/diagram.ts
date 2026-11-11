import { randomInt, randomUUID } from 'node:crypto';
import {
  DIAGRAM_COLORS,
  DIAGRAM_SHAPES,
  whiteboardElementIdSchema,
  type WhiteboardElement,
} from '@ordler/shared';
import { generateNKeysBetween } from 'fractional-indexing';
import { z } from 'zod';

/**
 * Turns an agent's nodes-and-edges description into editor elements (ADR 0015), and a board
 * back into such a description. Agents never write raw editor JSON: the format is large and
 * easy to get subtly wrong, while a graph is what they reason in.
 */

export const diagramNodeSchema = z.object({
  id: z.string().trim().min(1).max(64).describe('Your id for the node, used by edges'),
  label: z.string().max(500).default(''),
  shape: z.enum(DIAGRAM_SHAPES).default('rectangle'),
  color: z.enum(DIAGRAM_COLORS).optional(),
  x: z.number().finite().optional().describe('Omit x and y to lay the node out automatically'),
  y: z.number().finite().optional(),
});
export type DiagramNode = z.input<typeof diagramNodeSchema>;

export const diagramEdgeSchema = z.object({
  from: z.string().trim().min(1).max(64).describe('Node id, or an element id already on the board'),
  to: z.string().trim().min(1).max(64),
  label: z.string().max(200).optional(),
  style: z.enum(['solid', 'dashed']).default('solid'),
});
export type DiagramEdge = z.input<typeof diagramEdgeSchema>;

export const diagramSchema = z.object({
  nodes: z.array(diagramNodeSchema).max(200).default([]),
  edges: z.array(diagramEdgeSchema).max(400).default([]),
  direction: z.enum(['down', 'right']).default('down').describe('Flow of the automatic layout'),
});
export type DiagramInput = z.input<typeof diagramSchema>;

const PALETTE: Record<(typeof DIAGRAM_COLORS)[number], { stroke: string; fill: string }> = {
  gray: { stroke: '#495057', fill: '#e9ecef' },
  yellow: { stroke: '#1e1e1e', fill: '#ffec99' },
  blue: { stroke: '#1971c2', fill: '#a5d8ff' },
  green: { stroke: '#2f9e44', fill: '#b2f2bb' },
  red: { stroke: '#e03131', fill: '#ffc9c9' },
  purple: { stroke: '#6741d9', fill: '#d0bfff' },
  orange: { stroke: '#e8590c', fill: '#ffd8a8' },
};
const INK = '#1e1e1e';
const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
/** Excalifont, the editor's default hand-drawn font. */
const FONT_FAMILY = 5;
const CHARS_PER_LINE = 28;
/** A sticky note is a fixed square: its text wraps sooner. */
const STICKY_CHARS = 14;
const RANK_GAP = 110;
const SIBLING_GAP = 60;
const BOARD_GAP = 200;

type Box = { x: number; y: number; width: number; height: number };
type Element = WhiteboardElement & Record<string, unknown>;

/** Builds elements for new nodes and edges, placed to the right of what the board holds. */
export function buildDiagram(
  raw: DiagramInput,
  existing: WhiteboardElement[],
): WhiteboardElement[] {
  const input = diagramSchema.parse(raw);
  const live = (existing as Element[]).filter((e) => !e.isDeleted);
  const taken = new Set(live.map((e) => e.id));
  const ids = new Map<string, string>();
  for (const node of input.nodes) {
    if (ids.has(node.id)) throw new DiagramError(`Duplicate node id "${node.id}"`);
    const wanted = whiteboardElementIdSchema.safeParse(node.id);
    const id = wanted.success && !taken.has(node.id) ? node.id : newId();
    taken.add(id);
    ids.set(node.id, id);
  }

  const sizes = new Map(input.nodes.map((n) => [n.id, sizeOf(n.shape, n.label)]));
  const positions = layout(input, sizes, origin(live));

  const created: Element[] = [];
  const shapes = new Map<string, Element>();
  for (const node of input.nodes) {
    const box = { ...positions.get(node.id)!, ...sizes.get(node.id)! };
    const id = ids.get(node.id)!;
    if (node.shape === 'text') {
      const text = textElement(id, node.label, box, null, 'left');
      created.push(text);
      shapes.set(id, text);
      continue;
    }
    const colors = node.color
      ? PALETTE[node.color]
      : node.shape === 'sticky'
        ? PALETTE.yellow
        : { stroke: INK, fill: 'transparent' };
    const shape = base(id, node.shape === 'sticky' ? 'rectangle' : node.shape, box, {
      strokeColor: colors.stroke,
      backgroundColor: colors.fill,
      roundness: node.shape === 'ellipse' ? null : { type: node.shape === 'diamond' ? 2 : 3 },
    });
    created.push(shape);
    shapes.set(id, shape);
    if (node.label.trim()) {
      const text = textElement(
        newId(),
        node.label,
        inner(box, node.shape),
        id,
        'center',
        node.shape === 'sticky' ? STICKY_CHARS : CHARS_PER_LINE,
      );
      (shape.boundElements as unknown[]).push({ id: text.id, type: 'text' });
      created.push(text);
    }
  }

  // Edges may point at shapes already on the board; those get the arrow in boundElements.
  const touched = new Map<string, Element>();
  const target = (ref: string): Element => {
    const id = ids.get(ref) ?? ref;
    const found = shapes.get(id) ?? touched.get(id) ?? live.find((e) => e.id === id);
    if (!found || !BINDABLE.has(found.type)) {
      throw new DiagramError(`Edge end "${ref}" is not a node or a shape on the board`);
    }
    if (!shapes.has(found.id) && !touched.has(found.id)) {
      touched.set(found.id, {
        ...found,
        boundElements: [...((found.boundElements as unknown[] | null) ?? [])],
        version: found.version + 1,
        versionNonce: nonce(),
        updated: Date.now(),
      });
    }
    return shapes.get(found.id) ?? touched.get(found.id)!;
  };
  for (const edge of input.edges) {
    const from = target(edge.from);
    const to = target(edge.to);
    const [start, end] = connect(boxOf(from), boxOf(to));
    const arrow = base(
      newId(),
      'arrow',
      {
        x: start.x,
        y: start.y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      },
      {
        strokeColor: INK,
        backgroundColor: 'transparent',
        strokeStyle: edge.style,
        roundness: { type: 2 },
        points: [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ],
        lastCommittedPoint: null,
        startBinding: { elementId: from.id, focus: 0, gap: 8 },
        endBinding: { elementId: to.id, focus: 0, gap: 8 },
        startArrowhead: null,
        endArrowhead: 'arrow',
        elbowed: false,
      },
    );
    (from.boundElements as unknown[]).push({ id: arrow.id, type: 'arrow' });
    (to.boundElements as unknown[]).push({ id: arrow.id, type: 'arrow' });
    created.push(arrow);
    if (edge.label?.trim()) {
      const size = textSize(edge.label);
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const text = textElement(
        newId(),
        edge.label,
        { x: mid.x - size.width / 2, y: mid.y - size.height / 2, ...size },
        arrow.id,
        'center',
      );
      (arrow.boundElements as unknown[]).push({ id: text.id, type: 'text' });
      created.push(text);
    }
  }

  // New elements stack above everything already drawn, in creation order.
  const top = live
    .map((e) => e.index)
    .filter((i): i is string => typeof i === 'string')
    .sort()
    .at(-1);
  const keys = generateNKeysBetween(top ?? null, null, created.length);
  created.forEach((element, i) => (element.index = keys[i]));
  return [...created, ...touched.values()];
}

/** A board as an agent reads it: shapes with their labels, connectors and loose text. */
export function describeBoard(elements: WhiteboardElement[]) {
  const live = (elements as Element[]).filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const labelOf = (id: string) =>
    live.find((e) => e.type === 'text' && e.containerId === id)?.text as string | undefined;
  const round = (n: unknown) => Math.round(Number(n) || 0);
  const shapes = live
    .filter((e) => BINDABLE.has(e.type) && e.type !== 'text')
    .map((e) => ({
      id: e.id,
      type: e.type,
      label: labelOf(e.id) ?? null,
      x: round(e.x),
      y: round(e.y),
      width: round(e.width),
      height: round(e.height),
      color: (e.backgroundColor as string) ?? null,
    }));
  const connectors = live
    .filter((e) => e.type === 'arrow' || e.type === 'line')
    .map((e) => ({
      id: e.id,
      from: bindingTarget(e.startBinding, byId),
      to: bindingTarget(e.endBinding, byId),
      label: labelOf(e.id) ?? null,
    }));
  const texts = live
    .filter((e) => e.type === 'text' && !e.containerId)
    .map((e) => ({ id: e.id, text: e.text as string, x: round(e.x), y: round(e.y) }));
  return {
    shapes,
    connectors,
    texts,
    images: live.filter((e) => e.type === 'image').length,
    drawings: live.filter((e) => e.type === 'freedraw').length,
  };
}

export class DiagramError extends Error {}

const BINDABLE = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'image',
  'frame',
  'embeddable',
]);

function bindingTarget(binding: unknown, byId: Map<string, Element>): string | null {
  const id = (binding as { elementId?: string } | null)?.elementId;
  return id && byId.has(id) ? id : null;
}

function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}

function nonce(): number {
  return randomInt(0, 2_147_483_647);
}

function wrap(label: string, perLine = CHARS_PER_LINE): string[] {
  const lines: string[] = [];
  for (const paragraph of label.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > perLine) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Rough text metrics; the editor measures the real font when it loads the board. */
function textSize(label: string, perLine = CHARS_PER_LINE): { width: number; height: number } {
  const lines = wrap(label, perLine);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return {
    width: Math.ceil(longest * FONT_SIZE * 0.55),
    height: Math.ceil(lines.length * FONT_SIZE * LINE_HEIGHT),
  };
}

function sizeOf(shape: (typeof DIAGRAM_SHAPES)[number], label: string) {
  const text = textSize(label || ' ');
  if (shape === 'text') return text;
  if (shape === 'sticky') {
    return { width: 200, height: Math.max(200, textSize(label, STICKY_CHARS).height + 60) };
  }
  const width = Math.max(160, text.width + 50);
  const height = Math.max(70, text.height + 40);
  // Text inside ellipses and diamonds only fits in the middle part of the shape.
  if (shape === 'ellipse')
    return { width: Math.round(width * 1.3), height: Math.round(height * 1.3) };
  if (shape === 'diamond')
    return { width: Math.round(width * 1.6), height: Math.round(height * 1.6) };
  return { width, height };
}

function inner(box: Box, shape: string): Box {
  const shrink = shape === 'diamond' ? 0.5 : shape === 'ellipse' ? 0.7 : 0.85;
  const width = box.width * shrink;
  const height = box.height * shrink;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

function origin(live: Element[]): { x: number; y: number } {
  if (live.length === 0) return { x: 0, y: 0 };
  let right = -Infinity;
  let top = Infinity;
  for (const e of live) {
    right = Math.max(right, Number(e.x) + Math.max(0, Number(e.width) || 0));
    top = Math.min(top, Number(e.y));
  }
  return { x: Math.round(right + BOARD_GAP), y: Math.round(top) };
}

/** Layered layout: a node sits one rank after its furthest predecessor; cycles are cut. */
function layout(
  input: z.output<typeof diagramSchema>,
  sizes: Map<string, { width: number; height: number }>,
  start: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const known = new Set(input.nodes.map((n) => n.id));
  const incoming = new Map(input.nodes.map((n) => [n.id, [] as string[]]));
  for (const edge of input.edges) {
    if (known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to) {
      incoming.get(edge.to)!.push(edge.from);
    }
  }
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value = Math.max(-1, ...incoming.get(id)!.map(rankOf)) + 1;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  const auto = input.nodes.filter((n) => n.x === undefined || n.y === undefined);
  const ranks: string[][] = [];
  for (const node of auto) (ranks[rankOf(node.id)] ??= []).push(node.id);

  const down = input.direction === 'down';
  const breadth = (id: string) => (down ? sizes.get(id)!.width : sizes.get(id)!.height);
  const depth = (id: string) => (down ? sizes.get(id)!.height : sizes.get(id)!.width);
  const spans = ranks.map(
    (r) =>
      (r ?? []).reduce((sum, id) => sum + breadth(id), 0) +
      SIBLING_GAP * Math.max(0, (r ?? []).length - 1),
  );
  const widest = Math.max(0, ...spans);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of input.nodes) {
    if (node.x !== undefined && node.y !== undefined)
      positions.set(node.id, { x: node.x, y: node.y });
  }
  let along = 0;
  ranks.forEach((ids = [], r) => {
    let across = (widest - spans[r]!) / 2;
    const thickest = Math.max(0, ...ids.map(depth));
    for (const id of ids) {
      // Centre each node within its rank, so ranks of different sizes stay aligned.
      const offset = (thickest - depth(id)) / 2;
      positions.set(
        id,
        down
          ? { x: start.x + across, y: start.y + along + offset }
          : { x: start.x + along + offset, y: start.y + across },
      );
      across += breadth(id) + SIBLING_GAP;
    }
    along += thickest + RANK_GAP;
  });
  return positions;
}

function boxOf(element: Element): Box {
  return {
    x: Number(element.x),
    y: Number(element.y),
    width: Number(element.width),
    height: Number(element.height),
  };
}

/** Where the line between two box centres leaves each box. */
function connect(a: Box, b: Box): [{ x: number; y: number }, { x: number; y: number }] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const exit = (box: Box, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return from;
    const scale = Math.min(
      dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
      dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
    );
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  };
  return [exit(a, ca, cb), exit(b, cb, ca)];
}

function base(id: string, type: string, box: Box, extra: Record<string, unknown>): Element {
  return {
    id,
    type,
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: randomInt(1, 2_147_483_647),
    version: 1,
    versionNonce: nonce(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
}

function textElement(
  id: string,
  label: string,
  area: Box,
  containerId: string | null,
  align: 'left' | 'center',
  perLine = CHARS_PER_LINE,
): Element {
  const size = textSize(label, perLine);
  const text = wrap(label, perLine).join('\n');
  return base(
    id,
    'text',
    containerId
      ? {
          x: area.x + (area.width - size.width) / 2,
          y: area.y + (area.height - size.height) / 2,
          ...size,
        }
      : { x: area.x, y: area.y, ...size },
    {
      text,
      originalText: label,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
      textAlign: align,
      verticalAlign: containerId ? 'middle' : 'top',
      containerId,
      autoResize: true,
      lineHeight: LINE_HEIGHT,
      // Free text can be an arrow's end; text inside a shape never is.
      boundElements: containerId ? null : [],
    },
  );
}
