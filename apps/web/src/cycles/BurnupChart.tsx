import type { BurnupPoint } from '@ordler/shared';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 72, bottom: 24, left: 28 };

const SERIES = [
  { key: 'scope', color: 'var(--color-chart-scope)' },
  { key: 'completed', color: 'var(--color-chart-done)' },
] as const;

/**
 * Burn-up (SPEC §5.2): scope and completed issues per day. Two 2px lines on one axis, a legend
 * and end labels, a crosshair tooltip with both values, and a table for screen readers.
 */
export function BurnupChart({ points, language }: { points: BurnupPoint[]; language: string }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number>();
  if (points.length === 0) {
    return <p className="text-sm text-ink-muted">{t('cycles.notStarted')}</p>;
  }
  const max = Math.max(1, ...points.map((p) => p.scope));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const line = (key: 'scope' | 'completed') =>
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join(' ');
  const day = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const label = (date: string) => day.format(new Date(`${date}T00:00:00Z`));
  const last = points.at(-1)!;
  const ticks = [0, Math.round(max / 2), max].filter((v, i, all) => all.indexOf(v) === i);

  function onMove(event: MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH;
    const ratio = (px - PAD.left) / plotW;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  }

  const hovered = hover === undefined ? undefined : points[hover];
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-4 text-xs text-ink-muted">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-4 rounded-full"
              style={{ background: series.color }}
            />
            {t(`cycles.series.${series.key}`)}
          </span>
        ))}
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={t('cycles.burnupLabel', { scope: last.scope, completed: last.completed })}
          className="w-full"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(undefined)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--color-line)"
              />
              <text
                x={PAD.left - 6}
                y={y(v) + 3}
                textAnchor="end"
                className="fill-ink-faint text-[10px]"
              >
                {v}
              </text>
            </g>
          ))}
          <text x={x(0)} y={HEIGHT - 6} className="fill-ink-faint text-[10px]">
            {label(points[0]!.date)}
          </text>
          <text
            x={x(points.length - 1)}
            y={HEIGHT - 6}
            textAnchor="end"
            className="fill-ink-faint text-[10px]"
          >
            {label(last.date)}
          </text>
          {SERIES.map((series) => (
            <path
              key={series.key}
              d={line(series.key)}
              fill="none"
              stroke={series.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {/* Direct end labels: values in ink, the coloured mark carries identity. */}
          {SERIES.map((series) => (
            <text
              key={series.key}
              x={x(points.length - 1) + 8}
              y={y(last[series.key]) + 3}
              className="fill-ink text-[11px]"
            >
              {last[series.key]} {t(`cycles.series.${series.key}`).toLowerCase()}
            </text>
          ))}
          {hovered && (
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-ink-faint)"
              strokeDasharray="3 3"
            />
          )}
        </svg>
        {hovered && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 rounded-lg border border-line bg-card px-2 py-1 text-xs shadow-card"
            style={{ left: `${(x(hover!) / WIDTH) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <div className="text-ink-faint">{label(hovered.date)}</div>
            {SERIES.map((series) => (
              <div key={series.key} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-0.5 w-3 rounded-full"
                  style={{ background: series.color }}
                />
                <strong className="text-ink">{hovered[series.key]}</strong>
                <span className="text-ink-muted">{t(`cycles.series.${series.key}`)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer">{t('cycles.showTable')}</summary>
        <table className="mt-1 w-full text-left">
          <thead>
            <tr>
              <th className="font-medium">{t('cycles.date')}</th>
              <th className="font-medium">{t('cycles.series.scope')}</th>
              <th className="font-medium">{t('cycles.series.completed')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{label(p.date)}</td>
                <td>{p.scope}</td>
                <td>{p.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
