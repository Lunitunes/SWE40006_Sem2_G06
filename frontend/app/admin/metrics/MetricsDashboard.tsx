'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import LineChart from './LineChart';
import { formatBytes, formatBytesRate, formatDuration, formatPct, formatRate, formatTime } from './format';
import { RANGES, type MetricsResponse, type Point, type RangeKey } from './types';
import styles from './metrics.module.css';

const REFRESH_MS = 15_000; // matches the Prometheus scrape interval
const HOST_EMPTY = 'No host metrics. They come from node-exporter, which only runs on the Linux production server.';

const JOB_NAMES: Record<string, string> = {
  backend: 'Backend API',
  database: 'Database',
  node: 'Host (node-exporter)',
  prometheus: 'Prometheus',
  alertmanager: 'Alertmanager',
};

type Status = 'good' | 'warning' | 'critical';
const STATUS_ICON: Record<Status, string> = { good: '✓', warning: '!', critical: '✕' };

function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span className={styles.status}>
      <span className={`${styles.statusIcon} ${styles[status]}`} aria-hidden>
        {STATUS_ICON[status]}
      </span>
      {label}
    </span>
  );
}

function Sparkline({ points }: { points: Point[] }) {
  const values = points.map(([, v]) => v).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const max = Math.max(...values) || 1;
  const w = 120;
  const h = 28;
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join('');
  return (
    <svg width={w} height={h} className={styles.sparkline} aria-hidden>
      <path d={d} />
    </svg>
  );
}

function StatTile(props: { label: string; value: string; note: string; status?: Status; trend?: Point[] }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{props.label}</div>
      <div className={styles.tileValue}>{props.value}</div>
      <div className={styles.tileNote}>
        {props.status ? <StatusBadge status={props.status} label={props.note} /> : props.note}
      </div>
      {props.trend && <Sparkline points={props.trend} />}
    </div>
  );
}

async function fetchMetrics(
  range: RangeKey,
): Promise<{ data: MetricsResponse } | { error: string; needsLogin?: boolean }> {
  try {
    const res = await fetch(`/api/metrics?range=${range}`, { cache: 'no-store' });
    const body = await res.json();
    if (res.status === 401) return { error: body.error ?? 'Host login required.', needsLogin: true };
    return res.ok ? { data: body } : { error: body.error ?? `Request failed (${res.status})` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const toMegabytes = (points: Point[]): Point[] => points.map(([t, v]) => [t, v === null ? null : v / 1024 ** 2]);
const formatMegabytes = (v: number) => `${Math.round(v)} MB`;

// Total request rate per timestamp, for the request-rate sparkline
function sumSeries(...all: Point[][]): Point[] {
  const totals = new Map<number, number>();
  for (const s of all) for (const [t, v] of s) totals.set(t, (totals.get(t) ?? 0) + (v ?? 0));
  return [...totals].sort(([a], [b]) => a - b);
}

export default function MetricsDashboard() {
  const [range, setRange] = useState<RangeKey>('1h');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True while a refetch is in flight; the previous frame stays on screen, dimmed
  const [loading, setLoading] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchMetrics(range).then((result) => {
        // Drop responses for a range the user has already switched away from
        if (cancelled) return;
        if ('data' in result) {
          setData(result.data);
          setError(null);
          setNeedsLogin(false);
        } else if (result.needsLogin) {
          // Not logged in, or the session expired: hide the data rather than show stale numbers
          setData(null);
          setNeedsLogin(true);
        } else {
          // Keep showing the last good data; just flag that it's stale
          setError(result.error);
        }
        setLoading(false);
      });

    load();
    const id = setInterval(() => {
      setLoading(true);
      load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [range]);

  const s = data?.series;
  const domain: [number, number] = data ? [data.start, data.generatedAt] : [0, 1];
  const stats = data?.stats;
  const firing = data?.alerts.filter((a) => a.state === 'firing') ?? [];
  const pending = data?.alerts.filter((a) => a.state === 'pending') ?? [];

  const errorStatus: Status | undefined =
    stats?.errorPct == null ? undefined : stats.errorPct > 1 ? 'critical' : stats.errorPct > 0 ? 'warning' : 'good';
  const latencyStatus: Status | undefined =
    stats?.p95Seconds == null ? undefined : stats.p95Seconds > 1 ? 'critical' : stats.p95Seconds > 0.5 ? 'warning' : 'good';

  if (needsLogin) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Production metrics</h1>
            <p className={styles.subtitle}>
              Metrics are only available to hosts. <Link href="/host">Log in on the host dashboard</Link>, then come
              back to this page.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Production metrics</h1>
          <p className={styles.subtitle}>
            Live from Prometheus · refreshes every 15 seconds
            {data && <> · updated {formatTime(data.generatedAt, true)}</>}
          </p>
        </div>
      </header>

      <div className={styles.filters} role="group" aria-label="Time range">
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <button
            key={r}
            type="button"
            className={styles.rangeButton}
            aria-pressed={range === r}
            onClick={() => {
              if (r === range) return;
              setLoading(true);
              setRange(r);
            }}
          >
            Last {r}
          </button>
        ))}
      </div>

      {error && (
        <div className={styles.banner} role="alert">
          <StatusBadge status="critical" label={error} />
          {data && <span className={styles.bannerNote}>Showing the last data received.</span>}
        </div>
      )}

      {!data ? (
        <p className={styles.loading}>{error ? 'No metrics available.' : 'Loading metrics…'}</p>
      ) : (
        <div className={styles.content} style={{ opacity: loading ? 0.6 : 1 }}>
          <section aria-labelledby="services-h" className={styles.section}>
            <h2 id="services-h" className={styles.sectionTitle}>
              Services
            </h2>
            <ul className={styles.services}>
              {data.targets.map((t) => (
                <li key={t.job} className={styles.service} title={t.lastError || undefined}>
                  <StatusBadge
                    status={t.health === 'up' ? 'good' : t.health === 'down' ? 'critical' : 'warning'}
                    label={`${JOB_NAMES[t.job] ?? t.job}: ${t.health === 'up' ? 'Up' : t.health === 'down' ? 'Down' : 'Unknown'}`}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Key metrics, last 5 minutes" className={styles.tiles}>
            <StatTile
              label="Request rate (5m)"
              value={stats!.requestRate != null ? formatRate(stats!.requestRate) : '–'}
              note="All backend routes"
              trend={sumSeries(s!.requestsSuccess, s!.requestsClientError, s!.requestsServerError)}
            />
            <StatTile
              label="Server error rate (5m)"
              value={stats!.errorPct != null ? formatPct(stats!.errorPct) : '–'}
              note="Alert threshold 1%"
              status={errorStatus}
              trend={s!.errorPct}
            />
            <StatTile
              label="p95 latency (5m)"
              value={stats!.p95Seconds != null ? formatDuration(stats!.p95Seconds) : '–'}
              note={stats!.p95Seconds != null ? 'Alert threshold 1 s' : 'No requests in the last 5 minutes'}
              status={latencyStatus}
              trend={s!.latencyP95}
            />
            <StatTile
              label="Backend memory"
              value={stats!.memoryBytes != null ? formatBytes(stats!.memoryBytes) : '–'}
              note="Resident set size"
              trend={s!.memoryBytes}
            />
          </section>

          <section aria-labelledby="alerts-h" className={styles.section}>
            <h2 id="alerts-h" className={styles.sectionTitle}>
              Alerts
            </h2>
            {firing.length + pending.length === 0 ? (
              <StatusBadge status="good" label="No alerts firing" />
            ) : (
              <ul className={styles.alerts}>
                {[...firing, ...pending].map((a, i) => (
                  <li key={`${a.name}-${i}`} className={styles.alert}>
                    <StatusBadge
                      status={a.state === 'pending' ? 'warning' : a.severity === 'critical' ? 'critical' : 'warning'}
                      label={`${a.name} · ${a.state === 'pending' ? 'pending' : a.severity}`}
                    />
                    <span className={styles.alertSummary}>{a.summary}</span>
                    <span className={styles.alertTime}>since {formatTime(Date.parse(a.activeAt) / 1000, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="http-h" className={styles.section}>
            <h2 id="http-h" className={styles.sectionTitle}>
              HTTP request performance
            </h2>
            <div className={styles.grid}>
              <LineChart
                domain={domain}
                title="Requests per second"
                subtitle="By response class"
                format={formatRate}
                series={[
                  { label: 'Success (2xx/3xx)', color: 'var(--series-1)', points: s!.requestsSuccess },
                  { label: 'Client error (4xx)', color: 'var(--series-2)', points: s!.requestsClientError },
                  { label: 'Server error (5xx)', color: 'var(--series-3)', points: s!.requestsServerError },
                ]}
              />
              <LineChart
                domain={domain}
                title="Response time"
                subtitle="Percentiles across all routes"
                format={formatDuration}
                threshold={{ value: 1, label: 'p95 alert at 1 s' }}
                emptyText="No requests in this time range, so there is no latency to show."
                series={[
                  { label: 'p50', color: 'var(--series-1)', points: s!.latencyP50 },
                  { label: 'p95', color: 'var(--series-2)', points: s!.latencyP95 },
                  { label: 'p99', color: 'var(--series-3)', points: s!.latencyP99 },
                ]}
              />
              <LineChart
                domain={domain}
                title="Server error rate"
                subtitle="Share of requests returning 5xx"
                format={formatPct}
                yCap={100}
                threshold={{ value: 1, label: 'Alert at 1%' }}
                series={[{ label: '5xx rate', color: 'var(--series-1)', points: s!.errorPct }]}
              />
              <LineChart
                domain={domain}
                title="Backend memory"
                subtitle="Resident set size of the NestJS process"
                format={formatMegabytes}
                series={[{ label: 'Memory', color: 'var(--series-1)', points: toMegabytes(s!.memoryBytes) }]}
              />
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Routes</h3>
              <p className={styles.cardSubtitle}>Over the last {data.range}</p>
              {data.routes.length === 0 ? (
                <p className={styles.cardSubtitle}>No requests in this time range.</p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Route</th>
                        <th scope="col" className={styles.num}>
                          Requests
                        </th>
                        <th scope="col" className={styles.num}>
                          Server errors
                        </th>
                        <th scope="col" className={styles.num}>
                          p95 latency
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.routes.map((r) => (
                        <tr key={`${r.method} ${r.route}`}>
                          <td>
                            <code>
                              {r.method} {r.route}
                            </code>
                          </td>
                          <td className={styles.num}>{Math.round(r.requests).toLocaleString()}</td>
                          <td className={styles.num}>
                            {r.errorPct > 1 ? <StatusBadge status="critical" label={formatPct(r.errorPct)} /> : formatPct(r.errorPct)}
                          </td>
                          <td className={styles.num}>{r.p95Seconds != null ? formatDuration(r.p95Seconds) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="host-h" className={styles.section}>
            <h2 id="host-h" className={styles.sectionTitle}>
              Server resources
            </h2>
            <div className={styles.grid}>
              <LineChart
                domain={domain}
                title="CPU and memory"
                subtitle="Host utilisation"
                format={formatPct}
                yMax={100}
                emptyText={HOST_EMPTY}
                series={[
                  { label: 'CPU', color: 'var(--series-1)', points: s!.hostCpuPct },
                  { label: 'Memory', color: 'var(--series-2)', points: s!.hostMemPct },
                ]}
              />
              <LineChart
                domain={domain}
                title="Disk free space"
                subtitle="Fullest filesystem"
                format={formatPct}
                yMax={100}
                threshold={{ value: 20, label: 'Alerts start below 20%' }}
                emptyText={HOST_EMPTY}
                series={[{ label: 'Free space', color: 'var(--series-1)', points: s!.diskFreePct }]}
              />
              <LineChart
                domain={domain}
                title="Network traffic"
                subtitle="Host network interfaces"
                format={formatBytesRate}
                emptyText={HOST_EMPTY}
                series={[
                  { label: 'Received', color: 'var(--series-1)', points: s!.networkRx },
                  { label: 'Sent', color: 'var(--series-2)', points: s!.networkTx },
                ]}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
