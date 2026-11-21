import {
  WIKI_LINK_PATTERN,
  wikiLinkFromGroups,
  type WikiGraph,
  type WikiGraphNode,
  type WikiRelationView,
} from '@ordler/shared';

/**
 * `[[Title]]` and `[[Title|text]]` become ordinary Markdown links to the pages they name, using
 * the page's resolved relations; names nobody can open stay as plain text.
 */
export function linkWikiTitles(content: string, relations: readonly WikiRelationView[]): string {
  const byTitle = new Map<string, string>();
  for (const r of relations) {
    if (r.direction === 'out' && r.node.kind === 'wiki_page') {
      byTitle.set(r.node.label.trim().toLowerCase(), r.node.href);
    }
  }
  return content.replace(new RegExp(WIKI_LINK_PATTERN, 'g'), (match, ...groups: unknown[]) => {
    if (!match.startsWith('[[')) return match;
    const link = wikiLinkFromGroups(groups.slice(0, 5) as Array<string | undefined>);
    const alias = /\|([^\]\n]*)\]\]$/.exec(match)?.[1]?.trim();
    const text = (alias || link.ref).replace(/[[\]]/g, '');
    const href = byTitle.get(link.ref.toLowerCase());
    return href ? `[${text}](${href})` : text;
  });
}

/** Light palette (diagrams always render light): one colour per department, by order. */
export const DEPARTMENT_COLORS = [
  '#2563eb',
  '#16a34a',
  '#db2777',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
];

export const EXTERNAL_COLORS: Record<'issue' | 'request' | 'whiteboard', string> = {
  issue: '#64748b',
  request: '#0f766e',
  whiteboard: '#a16207',
};

/** Colours go only to spaces with pages, so the palette is not spent on empty ones. */
export function departmentColors(graph: WikiGraph): Map<string, string> {
  const withPages = new Set(
    graph.nodes.filter((n) => n.kind === 'wiki_page').map((n) => n.departmentId),
  );
  const departments = graph.nodes
    .filter((n) => n.kind === 'department' && withPages.has(n.departmentId))
    .sort((a, b) => a.label.localeCompare(b.label));
  return new Map(
    departments.map((d, i) => [d.departmentId!, DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length]!]),
  );
}

export function nodeColor(node: WikiGraphNode, colors: Map<string, string>): string {
  if (node.kind === 'issue' || node.kind === 'request' || node.kind === 'whiteboard') {
    return EXTERNAL_COLORS[node.kind];
  }
  return colors.get(node.departmentId ?? '') ?? DEPARTMENT_COLORS[0]!;
}

/** Radius by kind and by how connected a page is, like Obsidian's graph view. */
export function nodeRadius(node: WikiGraphNode, degree: number): number {
  if (node.kind === 'department') return 14;
  if (node.kind === 'folder') return 9;
  if (node.kind === 'wiki_page') return Math.min(12, 4 + Math.sqrt(degree) * 2);
  return 4;
}

/**
 * Layout ticks run up front, so the map appears settled. A company wiki of thousands of nodes
 * took two seconds at 300 ticks; above 1000 nodes 120 ticks with a faster cooling settle it too.
 */
export function layoutTicks(nodeCount: number): { ticks: number; alphaDecay?: number } {
  if (nodeCount <= 1000) return { ticks: 300, alphaDecay: undefined };
  const ticks = 120;
  // d3 stops cooling at alphaMin 0.001: reach it in exactly these ticks.
  return { ticks, alphaDecay: 1 - Math.pow(0.001, 1 / ticks) };
}

export interface MapFilter {
  /** Show folders and departments as cluster nodes. */
  clusters: boolean;
  /** Show linked issues, requests and whiteboards. */
  linked: boolean;
}

/** The graph with the chosen kinds of nodes and only edges between what is left. */
export function filterGraph(graph: WikiGraph, filter: MapFilter): WikiGraph {
  const keep = graph.nodes.filter((n) => {
    if (n.kind === 'department' || n.kind === 'folder') return filter.clusters;
    if (n.kind === 'wiki_page') return true;
    return filter.linked;
  });
  // Empty spaces and folders would only scatter the map: drop clusters nothing sits in,
  // twice so a department left with only empty folders goes too.
  let nodes = keep;
  for (let pass = 0; pass < 2; pass++) {
    const present = new Set(nodes.map((n) => n.id));
    const filled = new Set(
      graph.edges.filter((e) => e.type === 'in' && present.has(e.source)).map((e) => e.target),
    );
    nodes = nodes.filter(
      (n) => (n.kind !== 'department' && n.kind !== 'folder') || filled.has(n.id),
    );
  }
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    truncated: graph.truncated,
  };
}

/** Connections per node, cluster membership excluded. */
export function degrees(graph: WikiGraph): Map<string, number> {
  const result = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.type === 'in') continue;
    result.set(e.source, (result.get(e.source) ?? 0) + 1);
    result.set(e.target, (result.get(e.target) ?? 0) + 1);
  }
  return result;
}

/** A node and its direct neighbours: what lights up when one is hovered or searched. */
export function neighbourhood(graph: WikiGraph, ids: ReadonlySet<string>): Set<string> {
  const result = new Set(ids);
  for (const e of graph.edges) {
    if (ids.has(e.source)) result.add(e.target);
    if (ids.has(e.target)) result.add(e.source);
  }
  return result;
}
