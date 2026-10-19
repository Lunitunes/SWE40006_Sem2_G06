import type { NextRequest } from 'next/server';
import { RANGES, type Alert, type MetricsResponse, type Point, type RangeKey, type RouteStats, type Target } from '../../admin/metrics/types';

// Server-side only: in Docker this is http://prometheus:9090, which the browser can't reach directly
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

// Metrics are for hosts/operators: check the session cookie with the backend, which owns login
async function isHost(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  try {
    const res = await fetch(`${BACKEND_URL}/auth/me`, { headers: { cookie }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    return res.ok && (await res.json()).authenticated === true;
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';

const BACKEND = 'job="backend"';
// Available = backend up AND database reachable (database_up only exists while the backend is up).
// Same expression as the Grafana availability panels and the promtool test in alerts.test.yml.
const AVAILABLE = `((up{${BACKEND}} * on(instance, job) database_up) or up{${BACKEND}})`;
const availability = (range: string, step: string) => `100 * avg(avg_over_time(${AVAILABLE}[${range}:${step}]))`;
const FS = 'fstype!~"tmpfs|overlay|squashfs|ramfs"';
const NET = 'device!~"lo|veth.*|docker.*|br-.*"';

type PromSample = { metric: Record<string, string>; value?: [number, string]; values?: [number, string][] };

async function prom(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`/api/v1/${path}`, PROMETHEUS_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Prometheus ${path} returned ${res.status}`);
  const body = await res.json();
  if (body.status !== 'success') throw new Error(body.error ?? `Prometheus ${path} failed`);
  return body.data;
}

const toNumber = (v: string): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function instant(query: string): Promise<PromSample[]> {
  return ((await prom('query', { query })) as { result: PromSample[] }).result;
}

async function scalar(query: string): Promise<number | null> {
  const [first] = await instant(query);
  return first?.value ? toNumber(first.value[1]) : null;
}

export async function GET(request: NextRequest) {
  if (!(await isHost(request))) {
    return Response.json({ error: 'Host login required.' }, { status: 401 });
  }

  const param = request.nextUrl.searchParams.get('range');
  const range: RangeKey = param && param in RANGES ? (param as RangeKey) : '1h';
  const rangeSeconds = RANGES[range];
  // ~240 points per chart, never finer than the 15s scrape interval
  const step = Math.max(15, Math.ceil(rangeSeconds / 240));
  const win = `${Math.max(60, step * 2)}s`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeSeconds;

  const series = async (query: string): Promise<Point[]> => {
    const data = (await prom('query_range', { query, start: String(start), end: String(end), step: String(step) })) as {
      result: PromSample[];
    };
    return (data.result[0]?.values ?? []).map(([t, v]) => [t, toNumber(v)]);
  };

  const latency = (q: number) =>
    `histogram_quantile(${q}, sum by (le) (rate(http_request_duration_seconds_bucket{${BACKEND}}[${win}])))`;
  const errorPct = (w: string) =>
    `100 * (sum(rate(http_requests_total{${BACKEND}, status_code=~"5.."}[${w}])) / (sum(rate(http_requests_total{${BACKEND}}[${w}])) > 0)) or vector(0)`;
  const byClass = (re: string) => `sum(rate(http_requests_total{${BACKEND}, status_code=~"${re}"}[${win}])) or vector(0)`;

  try {
    const [
      targetsData,
      alertsData,
      requestRate,
      currentErrorPct,
      p95Seconds,
      memoryBytes,
      requestsSuccess,
      requestsClientError,
      requestsServerError,
      latencyP50,
      latencyP95,
      latencyP99,
      errorPctSeries,
      memorySeries,
      hostCpuPct,
      hostMemPct,
      diskFreePct,
      networkRx,
      networkTx,
      routeTotals,
      routeErrors,
      routeP95,
      databaseUp,
      availabilityPct,
      lifetimeAvailabilityPct,
    ] = await Promise.all([
      prom('targets', { state: 'active' }),
      prom('alerts'),
      scalar(`sum(rate(http_requests_total{${BACKEND}}[5m]))`),
      scalar(errorPct('5m')),
      scalar(`histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${BACKEND}}[5m])))`),
      scalar(`process_resident_memory_bytes{${BACKEND}}`),
      series(byClass('[23]..')),
      series(byClass('4..')),
      series(byClass('5..')),
      series(latency(0.5)),
      series(latency(0.95)),
      series(latency(0.99)),
      series(errorPct(win)),
      series(`process_resident_memory_bytes{${BACKEND}}`),
      series(`100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[${win}])))`),
      series('100 * (1 - avg(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))'),
      series(`100 * min(node_filesystem_avail_bytes{${FS}} / node_filesystem_size_bytes{${FS}})`),
      series(`sum(rate(node_network_receive_bytes_total{${NET}}[${win}]))`),
      series(`sum(rate(node_network_transmit_bytes_total{${NET}}[${win}]))`),
      instant(`sum by (method, route) (increase(http_requests_total{${BACKEND}}[${rangeSeconds}s]))`),
      instant(`sum by (method, route) (increase(http_requests_total{${BACKEND}, status_code=~"5.."}[${rangeSeconds}s]))`),
      instant(
        `histogram_quantile(0.95, sum by (method, route, le) (rate(http_request_duration_seconds_bucket{${BACKEND}}[${rangeSeconds}s])))`,
      ),
      scalar(`database_up{${BACKEND}}`),
      // Over the selected range, sampled at the chart step (at least every 15s)
      scalar(availability(`${rangeSeconds}s`, `${step}s`)),
      // Since monitoring started, as far back as Prometheus keeps data (15 days)
      scalar(availability('15d', '5m')),
    ]);

    const targets: Target[] = (
      targetsData as { activeTargets: { labels: { job: string }; health: Target['health']; lastError: string }[] }
    ).activeTargets
      .map((t) => ({ job: t.labels.job, health: t.health, lastError: t.lastError }));
    // PostgreSQL isn't scraped directly; the backend reports whether it can reach it
    targets.push({
      job: 'database',
      health: databaseUp === null ? 'unknown' : databaseUp === 1 ? 'up' : 'down',
      lastError: databaseUp === 0 ? 'The backend cannot connect to PostgreSQL' : '',
    });
    targets.sort((a, b) => a.job.localeCompare(b.job));

    const alerts: Alert[] = (
      alertsData as {
        alerts: { labels: Record<string, string>; annotations: Record<string, string>; state: Alert['state']; activeAt: string }[];
      }
    ).alerts.map((a) => ({
      name: a.labels.alertname,
      severity: a.labels.severity ?? 'warning',
      state: a.state,
      summary: a.annotations.summary ?? '',
      activeAt: a.activeAt,
    }));

    const key = (m: Record<string, string>) => `${m.method} ${m.route}`;
    const errorsByRoute = new Map(routeErrors.map((s) => [key(s.metric), toNumber(s.value![1]) ?? 0]));
    const p95ByRoute = new Map(routeP95.map((s) => [key(s.metric), toNumber(s.value![1])]));
    const routes: RouteStats[] = routeTotals
      .map((s) => {
        const requests = toNumber(s.value![1]) ?? 0;
        const errors = errorsByRoute.get(key(s.metric)) ?? 0;
        return {
          method: s.metric.method,
          route: s.metric.route,
          requests,
          errorPct: requests > 0 ? (100 * errors) / requests : 0,
          p95Seconds: p95ByRoute.get(key(s.metric)) ?? null,
        };
      })
      .filter((r) => r.requests >= 0.5)
      .sort((a, b) => b.requests - a.requests);

    const body: MetricsResponse = {
      start,
      generatedAt: end,
      range,
      stepSeconds: step,
      targets,
      alerts,
      stats: { requestRate, errorPct: currentErrorPct, p95Seconds, memoryBytes, availabilityPct, lifetimeAvailabilityPct },
      series: {
        requestsSuccess,
        requestsClientError,
        requestsServerError,
        latencyP50,
        latencyP95,
        latencyP99,
        errorPct: errorPctSeries,
        memoryBytes: memorySeries,
        hostCpuPct,
        hostMemPct,
        diskFreePct,
        networkRx,
        networkTx,
      },
      routes,
    };
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Can't reach Prometheus at ${PROMETHEUS_URL}: ${message}` }, { status: 502 });
  }
}
