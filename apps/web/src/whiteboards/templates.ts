/**
 * Ready-made starting points (SPEC §5.5), placed around the centre of the visible canvas.
 * They are editor skeletons: the editor turns them into elements and measures the text.
 */
export const TEMPLATE_KEYS = ['sticky', 'flowchart', 'retrospective', 'kanban', 'mindmap'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Text each template needs, translated by the caller. */
export const TEMPLATE_LABELS: Record<TemplateKey, readonly string[]> = {
  sticky: [],
  flowchart: ['start', 'step', 'decision', 'end', 'yes', 'no'],
  retrospective: ['wentWell', 'toImprove', 'actions'],
  kanban: ['todo', 'doing', 'done', 'card'],
  mindmap: ['topic', 'idea'],
};

const YELLOW = '#ffec99';
const COLUMN_FILLS = ['#d3f9d8', '#ffe3e3', '#d0ebff'];

type Skeleton = Record<string, unknown>;
type Point = { x: number; y: number };

function box(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  extra: Skeleton = {},
): Skeleton {
  return {
    type: 'rectangle',
    id,
    x,
    y,
    width,
    height,
    roundness: { type: 3 },
    label: { text },
    ...extra,
  };
}

function sticky(id: string, x: number, y: number, text = ''): Skeleton {
  return box(id, x, y, 180, 180, text, {
    backgroundColor: YELLOW,
    fillStyle: 'solid',
    strokeColor: '#e9b10a',
  });
}

function arrow(from: string, to: string, at: Point, text?: string): Skeleton {
  return {
    type: 'arrow',
    x: at.x,
    y: at.y,
    start: { id: from },
    end: { id: to },
    ...(text ? { label: { text } } : {}),
  };
}

function columns(titles: string[], center: Point, cardText?: string): Skeleton[] {
  const width = 260;
  const gap = 30;
  const left = center.x - (titles.length * width + (titles.length - 1) * gap) / 2;
  const top = center.y - 260;
  return titles.flatMap((title, i) => {
    const x = left + i * (width + gap);
    return [
      {
        type: 'rectangle',
        x,
        y: top,
        width,
        height: 520,
        backgroundColor: COLUMN_FILLS[i % COLUMN_FILLS.length],
        fillStyle: 'solid',
        strokeColor: 'transparent',
        roundness: { type: 3 },
      },
      { type: 'text', x: x + 20, y: top + 16, text: title, fontSize: 24 },
      ...(i === 0 || cardText === undefined
        ? [sticky(`col${i}-note`, x + 40, top + 70, cardText ?? '')]
        : []),
    ];
  });
}

export function templateSkeleton(
  key: TemplateKey,
  labels: Record<string, string>,
  center: Point,
): Skeleton[] {
  const l = (name: string) => labels[name] ?? name;
  switch (key) {
    case 'sticky':
      return [sticky(`sticky-${Date.now()}`, center.x - 90, center.y - 90)];
    case 'flowchart': {
      const x = center.x - 90;
      const y = center.y - 300;
      return [
        {
          type: 'ellipse',
          id: 'fc-start',
          x,
          y,
          width: 180,
          height: 70,
          label: { text: l('start') },
        },
        box('fc-step', x, y + 150, 180, 80, l('step')),
        {
          type: 'diamond',
          id: 'fc-decision',
          x: x - 20,
          y: y + 310,
          width: 220,
          height: 130,
          label: { text: l('decision') },
        },
        {
          type: 'ellipse',
          id: 'fc-end',
          x,
          y: y + 520,
          width: 180,
          height: 70,
          label: { text: l('end') },
        },
        arrow('fc-start', 'fc-step', { x: x + 90, y: y + 75 }),
        arrow('fc-step', 'fc-decision', { x: x + 90, y: y + 235 }),
        arrow('fc-decision', 'fc-end', { x: x + 90, y: y + 445 }, l('yes')),
        arrow('fc-decision', 'fc-step', { x: x + 205, y: y + 375 }, l('no')),
      ];
    }
    case 'retrospective':
      return columns([l('wentWell'), l('toImprove'), l('actions')], center, '');
    case 'kanban':
      return columns([l('todo'), l('doing'), l('done')], center, l('card'));
    case 'mindmap': {
      const hub = {
        type: 'ellipse',
        id: 'mm-hub',
        x: center.x - 110,
        y: center.y - 50,
        width: 220,
        height: 100,
        backgroundColor: '#d0bfff',
        fillStyle: 'solid',
        label: { text: l('topic') },
      };
      const spots: Point[] = [
        { x: -380, y: -220 },
        { x: 220, y: -220 },
        { x: -380, y: 160 },
        { x: 220, y: 160 },
      ];
      return [
        hub,
        ...spots.flatMap((spot, i) => [
          box(`mm-${i}`, center.x + spot.x, center.y + spot.y, 160, 70, l('idea')),
          arrow('mm-hub', `mm-${i}`, { x: center.x, y: center.y }),
        ]),
      ];
    }
  }
}
