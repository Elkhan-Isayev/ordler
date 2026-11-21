import type { WikiGraph, WikiGraphNode, WikiSpace } from '@ordler/shared';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { Maximize, Minus, Plus, Search } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ghostButtonClass, inputClass } from '../admin/common.js';
import { api } from '../api/client.js';
import { errorKey } from '../auth/errors.js';
import { FormError } from '../auth/form.js';
import { selectClass } from '../issues/ui.js';
import { Link, navigate } from '../router.js';
import {
  EXTERNAL_COLORS,
  degrees,
  departmentColors,
  filterGraph,
  layoutTicks,
  neighbourhood,
  nodeColor,
  nodeRadius,
  type MapFilter,
} from './graph.js';

interface MapNode extends SimulationNodeDatum, WikiGraphNode {
  radius: number;
}
type MapLink = SimulationLinkDatum<MapNode> & { type: string };

/** Above this many nodes, only clusters and highlighted nodes carry labels. */
const LABEL_LIMIT = 150;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

/** Positions for every node, laid out by a force simulation (clusters pull their pages). */
export function layout(graph: WikiGraph): { nodes: MapNode[]; links: MapLink[] } {
  const degree = degrees(graph);
  const nodes: MapNode[] = graph.nodes.map((n) => ({
    ...n,
    radius: nodeRadius(n, degree.get(n.id) ?? 0),
  }));
  const links: MapLink[] = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.type,
  }));
  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink<MapNode, MapLink>(links)
        .id((n) => n.id)
        .distance((l) => (l.type === 'in' ? 40 : 80))
        .strength((l) => (l.type === 'in' ? 0.7 : 0.25)),
    )
    .force('charge', forceManyBody().strength(-140))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide<MapNode>().radius((n) => n.radius + 3),
    )
    .stop();
  // Ticks run up front: the map appears settled, and tests see the same layout every time.
  const { ticks, alphaDecay } = layoutTicks(nodes.length);
  if (alphaDecay !== undefined) simulation.alphaDecay(alphaDecay);
  simulation.tick(ticks);
  return { nodes, links };
}

/**
 * /wiki/map (and /wiki/map/:department): the company wiki as a graph, like Obsidian's graph
 * view (ADR 0018). Departments and folders are cluster nodes; pages link to pages, issues,
 * requests and boards. Always drawn on light, like every diagram in Ordler.
 */
export function WikiMap({ departmentId }: { departmentId?: string }) {
  const { t } = useTranslation();
  const [graph, setGraph] = useState<WikiGraph>();
  const [spaces, setSpaces] = useState<WikiSpace[]>([]);
  const [filter, setFilter] = useState<MapFilter>({ clusters: true, linked: true });
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<string>();
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [error, setError] = useState<string>();
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let current = true;
    setGraph(undefined);
    api
      .wikiGraph(departmentId)
      .then((g) => current && setGraph(g))
      .catch((failure: unknown) => current && setError(errorKey(failure)));
    return () => {
      current = false;
    };
  }, [departmentId]);

  useEffect(() => {
    api
      .wikiSpaces()
      .then(setSpaces)
      .catch(() => setSpaces([]));
  }, []);

  const shown = useMemo(() => (graph ? filterGraph(graph, filter) : undefined), [graph, filter]);
  const placed = useMemo(() => (shown ? layout(shown) : undefined), [shown]);
  const colors = useMemo(
    () => (graph ? departmentColors(graph) : new Map<string, string>()),
    [graph],
  );

  const highlighted = useMemo(() => {
    if (!shown) return undefined;
    const text = query.trim().toLowerCase();
    const seeds = new Set<string>();
    if (hovered) seeds.add(hovered);
    if (text.length >= 2) {
      for (const n of shown.nodes) if (n.label.toLowerCase().includes(text)) seeds.add(n.id);
    }
    return seeds.size > 0 ? neighbourhood(shown, seeds) : undefined;
  }, [shown, query, hovered]);

  const bounds = useMemo(() => {
    if (!placed || placed.nodes.length === 0) return { x: -200, y: -150, w: 400, h: 300 };
    const xs = placed.nodes.map((n) => n.x ?? 0);
    const ys = placed.nodes.map((n) => n.y ?? 0);
    const pad = 60;
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) - x + pad, h: Math.max(...ys) - y + pad };
  }, [placed]);

  const zoom = (factor: number) =>
    setView((v) => ({ ...v, k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor)) }));

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
  }
  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest('[data-node]')) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const svg = event.currentTarget.getBoundingClientRect();
    // Screen pixels to viewBox units, so the map follows the pointer.
    const scale = svg.width > 0 ? bounds.w / svg.width : 1;
    const dx = (event.clientX - drag.current.x) * scale;
    const dy = (event.clientY - drag.current.y) * scale;
    drag.current = { x: event.clientX, y: event.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }
  const onPointerUp = () => (drag.current = null);

  const labelAll = (placed?.nodes.length ?? 0) <= LABEL_LIMIT;
  const departments =
    graph?.nodes.filter((n) => n.kind === 'department' && colors.has(n.departmentId ?? '')) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <nav aria-label={t('wiki.breadcrumbs')} className="flex items-center gap-1 text-sm">
          <Link href="/wiki" className="text-ink-muted hover:underline">
            {t('nav.wiki')}
          </Link>
          <span className="text-ink-faint">/</span>
          <h1 className="font-semibold text-ink">{t('wiki.map.title')}</h1>
        </nav>
        <select
          aria-label={t('wiki.map.space')}
          value={departmentId ?? ''}
          onChange={(event) =>
            navigate(event.target.value ? `/wiki/map/${event.target.value}` : '/wiki/map')
          }
          className={selectClass}
        >
          <option value="">{t('wiki.map.allSpaces')}</option>
          {spaces.map((s) => (
            <option key={s.department.id} value={s.department.id}>
              {s.department.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={filter.clusters}
            onChange={(event) => setFilter((f) => ({ ...f, clusters: event.target.checked }))}
          />
          {t('wiki.map.clusters')}
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={filter.linked}
            onChange={(event) => setFilter((f) => ({ ...f, linked: event.target.checked }))}
          />
          {t('wiki.map.linked')}
        </label>
        <label className="relative w-full sm:ml-auto sm:w-auto">
          <Search
            aria-hidden
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('wiki.map.search')}
            placeholder={t('wiki.map.search')}
            className={`${inputClass} w-full pl-8 sm:w-56`}
          />
        </label>
      </header>
      {error && (
        <div className="p-4">
          <FormError message={t(error)} />
        </div>
      )}
      {graph && graph.nodes.filter((n) => n.kind === 'wiki_page').length === 0 && (
        <p className="p-8 text-center text-sm text-ink-muted">{t('wiki.map.empty')}</p>
      )}
      {placed && placed.nodes.length > 0 && (
        // Diagrams render light in every theme (SPEC §5.4), so colours here are fixed.
        <div
          className="relative min-h-0 flex-1"
          style={{ background: '#ffffff', color: '#1f2937' }}
        >
          <svg
            role="img"
            aria-label={t('wiki.map.title')}
            viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
            className="h-full w-full touch-none select-none"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {placed.links.map((l, i) => {
                const s = l.source as MapNode;
                const d = l.target as MapNode;
                const lit = highlighted?.has(s.id) && highlighted.has(d.id);
                return (
                  <line
                    key={i}
                    x1={s.x}
                    y1={s.y}
                    x2={d.x}
                    y2={d.y}
                    stroke={l.type === 'in' ? '#cbd5e1' : '#94a3b8'}
                    strokeWidth={l.type === 'in' ? 0.8 : 1.2}
                    strokeDasharray={l.type === 'in' ? '3 3' : undefined}
                    opacity={highlighted && !lit ? 0.15 : 0.9}
                  >
                    <title>{t(`wiki.relations.out.${l.type === 'in' ? 'in' : l.type}`)}</title>
                  </line>
                );
              })}
              {placed.nodes.map((n) => {
                const dim = highlighted !== undefined && !highlighted.has(n.id);
                const cluster = n.kind === 'department' || n.kind === 'folder';
                const showLabel = labelAll || cluster || highlighted?.has(n.id);
                const open = () => n.href && navigate(n.href);
                return (
                  <g
                    key={n.id}
                    data-node={n.kind}
                    role="link"
                    tabIndex={0}
                    aria-label={`${t(`wiki.map.kinds.${n.kind}`)}: ${n.label}`}
                    transform={`translate(${n.x ?? 0} ${n.y ?? 0})`}
                    opacity={dim ? 0.2 : 1}
                    className="cursor-pointer outline-none"
                    onClick={open}
                    onKeyDown={(event: KeyboardEvent) => event.key === 'Enter' && open()}
                    onPointerEnter={() => setHovered(n.id)}
                    onPointerLeave={() => setHovered(undefined)}
                    onFocus={() => setHovered(n.id)}
                    onBlur={() => setHovered(undefined)}
                  >
                    {n.kind === 'folder' || n.kind === 'department' ? (
                      <circle
                        r={n.radius}
                        fill="#ffffff"
                        stroke={nodeColor(n, colors)}
                        strokeWidth={n.kind === 'department' ? 3 : 2}
                      />
                    ) : n.kind === 'wiki_page' ? (
                      <circle r={n.radius} fill={nodeColor(n, colors)} />
                    ) : (
                      <rect
                        x={-n.radius}
                        y={-n.radius}
                        width={n.radius * 2}
                        height={n.radius * 2}
                        fill={nodeColor(n, colors)}
                      />
                    )}
                    {showLabel && (
                      <text
                        y={n.radius + 10}
                        textAnchor="middle"
                        fontSize={n.kind === 'department' ? 11 : 8}
                        fontWeight={cluster ? 600 : 400}
                        fill="#1f2937"
                      >
                        {n.label.length > 40 ? `${n.label.slice(0, 39)}…` : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            <button
              type="button"
              aria-label={t('wiki.map.zoomIn')}
              className={ghostButtonClass}
              style={{ background: '#ffffff', color: '#1f2937' }}
              onClick={() => zoom(1.25)}
            >
              <Plus aria-hidden size={14} />
            </button>
            <button
              type="button"
              aria-label={t('wiki.map.zoomOut')}
              className={ghostButtonClass}
              style={{ background: '#ffffff', color: '#1f2937' }}
              onClick={() => zoom(0.8)}
            >
              <Minus aria-hidden size={14} />
            </button>
            <button
              type="button"
              aria-label={t('wiki.map.reset')}
              className={ghostButtonClass}
              style={{ background: '#ffffff', color: '#1f2937' }}
              onClick={() => setView({ x: 0, y: 0, k: 1 })}
            >
              <Maximize aria-hidden size={14} />
            </button>
          </div>
          <ul
            aria-label={t('wiki.map.legend')}
            className="absolute bottom-3 left-3 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1 rounded-md px-2 py-1 text-xs"
            style={{ background: 'rgba(255,255,255,0.9)', color: '#374151' }}
          >
            {departments.map((d) => (
              <li key={d.id} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: colors.get(d.departmentId ?? '') }}
                />
                {d.label}
              </li>
            ))}
            {filter.linked &&
              (['issue', 'request', 'whiteboard'] as const).map((kind) => (
                <li key={kind} className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5"
                    style={{ background: EXTERNAL_COLORS[kind] }}
                  />
                  {t(`wiki.map.kinds.${kind}`)}
                </li>
              ))}
          </ul>
          {graph?.truncated && (
            <p
              className="absolute top-3 left-3 rounded-md px-2 py-1 text-xs"
              style={{ background: '#fef3c7', color: '#92400e' }}
            >
              {t('wiki.map.truncated')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
