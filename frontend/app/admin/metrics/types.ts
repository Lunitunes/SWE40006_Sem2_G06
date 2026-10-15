// Shared between the /api/metrics route handler and the dashboard

export const RANGES = { '15m': 15 * 60, '1h': 60 * 60, '6h': 6 * 60 * 60, '24h': 24 * 60 * 60 } as const;
export type RangeKey = keyof typeof RANGES;

// [unix seconds, value]; value is null where Prometheus has no sample (e.g. NaN latency with no traffic)
export type Point = [number, number | null];

export type Target = { job: string; health: 'up' | 'down' | 'unknown'; lastError: string };

export type Alert = {
  name: string;
  severity: string;
  state: 'firing' | 'pending' | 'inactive';
  summary: string;
  activeAt: string;
};

export type RouteStats = {
  method: string;
  route: string;
  requests: number;
  errorPct: number;
  p95Seconds: number | null;
};

export type MetricsResponse = {
  // Unix seconds; start..generatedAt is the queried time range
  start: number;
  generatedAt: number;
  range: RangeKey;
  stepSeconds: number;
  targets: Target[];
  alerts: Alert[];
  stats: {
    requestRate: number | null;
    errorPct: number | null;
    p95Seconds: number | null;
    memoryBytes: number | null;
  };
  series: {
    requestsSuccess: Point[];
    requestsClientError: Point[];
    requestsServerError: Point[];
    latencyP50: Point[];
    latencyP95: Point[];
    latencyP99: Point[];
    errorPct: Point[];
    memoryBytes: Point[];
    hostCpuPct: Point[];
    hostMemPct: Point[];
    diskFreePct: Point[];
    networkRx: Point[];
    networkTx: Point[];
  };
  routes: RouteStats[];
};
