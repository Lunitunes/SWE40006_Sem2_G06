const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatNumber(v: number): string {
  return Math.abs(v) >= 1000 ? compact.format(v) : v.toFixed(v < 10 && v % 1 !== 0 ? 2 : 0);
}

export function formatRate(v: number): string {
  if (v === 0) return '0/s';
  return v < 0.1 ? `${(v * 60).toFixed(1)}/min` : `${formatNumber(v)}/s`;
}

export function formatPct(v: number): string {
  return `${v < 10 && v !== 0 ? v.toFixed(1) : Math.round(v)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
}

export function formatBytes(v: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const formatBytesRate = (v: number) => `${formatBytes(v)}/s`;

export function formatTime(unixSeconds: number, withSeconds = false): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

// 3-6 round tick values covering [0, max]
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(12)));
  return ticks;
}

// Availability is rounded down, so 99.996% shows as 99.99%, never as a misleading "100.00%"
export function formatAvailability(v: number): string {
  if (v >= 100) return '100%';
  return `${(Math.floor(v * 100) / 100).toFixed(2)}%`;
}
