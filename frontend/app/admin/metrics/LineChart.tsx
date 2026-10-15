'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatTime, niceTicks } from './format';
import type { Point } from './types';
import styles from './metrics.module.css';

export type Series = {
  label: string;
  // CSS variable for the categorical slot, e.g. 'var(--series-1)'; fixed per entity, never by rank
  color: string;
  points: Point[];
};

type Props = {
  title: string;
  subtitle?: string;
  series: Series[];
  format: (v: number) => string;
  // [start, end] in unix seconds, so every chart on the page shares the selected time range
  domain: [number, number];
  // Fixed y-axis maximum (e.g. 100 for percentages); otherwise fitted to the data
  yMax?: number;
  // Upper limit for a fitted axis (e.g. a percentage that can't exceed 100)
  yCap?: number;
  threshold?: { value: number; label: string };
  emptyText?: string;
};

const HEIGHT = 220;
const M = { top: 12, right: 72, bottom: 28, left: 52 };

export default function LineChart({ title, subtitle, series, format, domain, yMax, yCap, threshold, emptyText }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Every series is queried over the same range/step, so the union of timestamps is the shared x grid
  const times = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map(([t]) => t)))].sort((a, b) => a - b),
    [series],
  );
  const lookups = useMemo(() => series.map((s) => new Map(s.points)), [series]);
  const hasData = series.some((s) => s.points.some(([, v]) => v !== null));

  const dataMax = Math.max(0, ...series.flatMap((s) => s.points.map(([, v]) => v ?? 0)));
  // Only stretch the axis to show the threshold when the data comes near it; otherwise the
  // real values get squashed flat against the baseline and the threshold is noted in text instead
  const showThreshold = !!threshold && (yMax !== undefined ? threshold.value <= yMax : dataMax >= threshold.value * 0.4);
  let ticks = niceTicks(yMax ?? Math.max(dataMax, showThreshold ? threshold!.value : 0) * 1.1);
  if (yCap !== undefined && ticks[ticks.length - 1] > yCap) ticks = [...ticks.filter((v) => v < yCap), yCap];
  const top = yMax ?? ticks[ticks.length - 1];

  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const [t0, t1] = domain;
  const x = (t: number) => M.left + (t1 === t0 ? plotW : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => M.top + plotH - (Math.min(v, top) / top) * plotH;

  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    for (const [t, v] of s.points) {
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  });

  const lastPoint = (s: Series) => [...s.points].reverse().find(([, v]) => v !== null) as [number, number] | undefined;

  // Direct end-labels only where they don't collide (and not on narrow screens, where they'd
  // overflow the card); the legend always carries identity
  const endLabels = useMemo(() => {
    const placed: { i: number; y: number }[] = [];
    if (width < 480 && series.length > 1) return placed;
    series
      .map((s, i) => ({ i, last: lastPoint(s) }))
      .filter((e): e is { i: number; last: [number, number] } => !!e.last)
      .sort((a, b) => y(a.last[1]) - y(b.last[1]))
      .forEach(({ i, last }) => {
        const ly = y(last[1]);
        if (placed.every((p) => Math.abs(p.y - ly) >= 14)) placed.push({ i, y: ly });
      });
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, top, plotH, width]);

  const xTickCount = Math.max(2, Math.min(6, Math.floor(plotW / 110)));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => t0 + ((t1 - t0) * i) / (xTickCount - 1));

  const nearestIndex = (px: number) => {
    if (!times.length) return null;
    const t = t0 + ((px - M.left) / plotW) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
    return best;
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(e.clientX - rect.left));
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!times.length) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      setHover((h) => Math.min(times.length - 1, Math.max(0, (h ?? times.length - 1) + delta)));
    } else if (e.key === 'Escape') setHover(null);
  };

  const hoverT = hover !== null ? times[hover] : null;
  const tooltipLeft = hoverT !== null ? x(hoverT) : 0;
  const flip = tooltipLeft > width - 200;

  const tableRows = times.slice(-12).reverse();

  return (
    <figure className={styles.card}>
      <figcaption className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        {threshold && !showThreshold && hasData && (
          <p className={styles.cardSubtitle}>
            {threshold.label} (well above current values, so not drawn)
          </p>
        )}
        {series.length > 1 && hasData && (
          <ul className={styles.legend}>
            {series.map((s) => (
              <li key={s.label}>
                <span className={styles.lineKey} style={{ background: s.color }} aria-hidden />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </figcaption>

      <div ref={wrapRef} className={styles.plot}>
        {!hasData ? (
          <p className={styles.empty} style={{ height: HEIGHT }}>
            {emptyText ?? 'No data in this time range yet.'}
          </p>
        ) : (
          <>
            <svg
              width={width}
              height={HEIGHT}
              // Until the ResizeObserver reports the real width, the viewBox scales the drawing to fit
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              aria-label={`${title}. Use left and right arrow keys to read values.`}
              tabIndex={0}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKeyDown}
              onBlur={() => setHover(null)}
              className={styles.svg}
            >
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} className={v === 0 ? styles.baseline : styles.gridline} />
                  <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className={styles.axisText}>
                    {format(v)}
                  </text>
                </g>
              ))}
              {xTicks.map((t, i) => (
                <text
                  key={t}
                  x={x(t)}
                  y={HEIGHT - 8}
                  textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                  className={styles.axisText}
                >
                  {formatTime(t)}
                </text>
              ))}

              {threshold && showThreshold && threshold.value <= top && (
                <g>
                  <line x1={M.left} x2={M.left + plotW} y1={y(threshold.value)} y2={y(threshold.value)} className={styles.threshold} />
                  <text x={M.left + 4} y={y(threshold.value) - 5} className={styles.thresholdText}>
                    {threshold.label}
                  </text>
                </g>
              )}

              {series.length === 1 && paths[0] && (
                <path
                  d={`${paths[0]}L${x(lastPoint(series[0])?.[0] ?? t1)},${y(0)}L${x(series[0].points.find(([, v]) => v !== null)?.[0] ?? t0)},${y(0)}Z`}
                  fill={series[0].color}
                  opacity={0.1}
                />
              )}
              {paths.map((d, i) => (
                <path key={series[i].label} d={d} fill="none" stroke={series[i].color} className={styles.line} />
              ))}

              {series.map((s) => {
                const last = lastPoint(s);
                return last ? (
                  <circle key={s.label} cx={x(last[0])} cy={y(last[1])} r={4} fill={s.color} className={styles.dot} />
                ) : null;
              })}
              {endLabels.map(({ i, y: ly }) => (
                <text key={series[i].label} x={M.left + plotW + 10} y={ly} dy="0.32em" className={styles.endLabel}>
                  {series.length > 1 ? series[i].label : format(lastPoint(series[i])![1])}
                </text>
              ))}

              {hoverT !== null && (
                <g pointerEvents="none">
                  <line x1={x(hoverT)} x2={x(hoverT)} y1={M.top} y2={M.top + plotH} className={styles.crosshair} />
                  {series.map((s, i) => {
                    const v = lookups[i].get(hoverT);
                    return v != null ? <circle key={s.label} cx={x(hoverT)} cy={y(v)} r={4} fill={s.color} className={styles.dot} /> : null;
                  })}
                </g>
              )}
            </svg>

            {hoverT !== null && (
              <div
                className={styles.tooltip}
                style={{ left: tooltipLeft, transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
                role="status"
              >
                <div className={styles.tooltipTime}>{formatTime(hoverT, true)}</div>
                {series.map((s, i) => {
                  const v = lookups[i].get(hoverT);
                  return (
                    <div key={s.label} className={styles.tooltipRow}>
                      <span className={styles.lineKey} style={{ background: s.color }} aria-hidden />
                      <strong>{v != null ? format(v) : '–'}</strong>
                      <span>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {hasData && (
        <details className={styles.tableToggle}>
          <summary>Data table (latest 12 points)</summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                {series.map((s) => (
                  <th key={s.label} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((t) => (
                <tr key={t}>
                  <td>{formatTime(t, true)}</td>
                  {series.map((s, i) => {
                    const v = lookups[i].get(t);
                    return <td key={s.label}>{v != null ? format(v) : '–'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
