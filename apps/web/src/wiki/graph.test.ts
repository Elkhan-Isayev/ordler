import type { WikiGraph, WikiRelationView } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import {
  degrees,
  departmentColors,
  filterGraph,
  layoutTicks,
  linkWikiTitles,
  neighbourhood,
  nodeRadius,
} from './graph.js';

const VPN = '0193a000-0000-7000-8000-0000000000a2';

function relation(label: string, href: string): WikiRelationView {
  return {
    id: null,
    type: 'references',
    direction: 'out',
    origin: 'link',
    node: { kind: 'wiki_page', ref: VPN, label, href },
    note: null,
    canRemove: false,
  };
}

describe('linkWikiTitles', () => {
  it('turns [[Title]] into links to readable pages and leaves the rest as text', () => {
    const text = 'Use [[vpn setup]], [[VPN setup|the VPN]], [[Secret]] and [x](/issue/HELP-1).';
    expect(linkWikiTitles(text, [relation('VPN setup', `/wiki/page/${VPN}`)])).toBe(
      `Use [vpn setup](/wiki/page/${VPN}), [the VPN](/wiki/page/${VPN}), Secret and [x](/issue/HELP-1).`,
    );
  });
});

const GRAPH: WikiGraph = {
  nodes: [
    { id: 'department:d', kind: 'department', label: 'IT', href: '/wiki/d', departmentId: 'd' },
    { id: 'folder:f', kind: 'folder', label: 'Guides', href: '/wiki/d', departmentId: 'd' },
    { id: 'wiki_page:a', kind: 'wiki_page', label: 'A', href: '/wiki/page/a', departmentId: 'd' },
    { id: 'wiki_page:b', kind: 'wiki_page', label: 'B', href: '/wiki/page/b', departmentId: 'd' },
    {
      id: 'issue:HELP-1',
      kind: 'issue',
      label: 'HELP-1',
      href: '/issue/HELP-1',
      departmentId: null,
    },
  ],
  edges: [
    { source: 'folder:f', target: 'department:d', type: 'in' },
    { source: 'wiki_page:a', target: 'folder:f', type: 'in' },
    { source: 'wiki_page:b', target: 'department:d', type: 'in' },
    { source: 'wiki_page:a', target: 'wiki_page:b', type: 'depends_on' },
    { source: 'wiki_page:a', target: 'issue:HELP-1', type: 'references' },
  ],
  truncated: false,
};

describe('map helpers', () => {
  it('hides clusters or linked items with their edges', () => {
    const pages = filterGraph(GRAPH, { clusters: false, linked: false });
    expect(pages.nodes.map((n) => n.id)).toEqual(['wiki_page:a', 'wiki_page:b']);
    expect(pages.edges).toEqual([
      { source: 'wiki_page:a', target: 'wiki_page:b', type: 'depends_on' },
    ]);
    expect(filterGraph(GRAPH, { clusters: true, linked: true }).edges).toHaveLength(5);
  });

  it('drops spaces and folders without pages', () => {
    const graph: WikiGraph = {
      ...GRAPH,
      nodes: [
        ...GRAPH.nodes,
        { id: 'department:e', kind: 'department', label: 'HR', href: '/wiki/e', departmentId: 'e' },
        { id: 'folder:g', kind: 'folder', label: 'Empty', href: '/wiki/e', departmentId: 'e' },
      ],
      edges: [...GRAPH.edges, { source: 'folder:g', target: 'department:e', type: 'in' }],
    };
    const ids = filterGraph(graph, { clusters: true, linked: true }).nodes.map((n) => n.id);
    expect(ids).toContain('department:d');
    expect(ids).toContain('folder:f');
    expect(ids).not.toContain('folder:g');
    expect(ids).not.toContain('department:e');
    expect([...departmentColors(graph).keys()]).toEqual(['d']);
  });

  it('sizes pages by connections, without cluster membership', () => {
    const degree = degrees(GRAPH);
    expect(degree.get('wiki_page:a')).toBe(2);
    expect(degree.get('folder:f')).toBeUndefined();
    expect(nodeRadius(GRAPH.nodes[2]!, 4)).toBeGreaterThan(nodeRadius(GRAPH.nodes[3]!, 1));
  });

  it('lights up a node with its neighbours', () => {
    expect([...neighbourhood(GRAPH, new Set(['wiki_page:b']))].sort()).toEqual([
      'department:d',
      'wiki_page:a',
      'wiki_page:b',
    ]);
  });
});

describe('layoutTicks', () => {
  it('settles small maps fully and spends fewer ticks on company-sized ones', () => {
    expect(layoutTicks(50)).toEqual({ ticks: 300, alphaDecay: undefined });
    const big = layoutTicks(2400);
    expect(big.ticks).toBe(120);
    // Cools to d3's alphaMin within those ticks, so the map still comes out settled.
    expect((1 - big.alphaDecay!) ** big.ticks).toBeCloseTo(0.001, 6);
  });
});
