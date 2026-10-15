import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    metricsService = new MetricsService();
  });

  it('should expose default Node.js process metrics', async () => {
    const output = await metricsService.getMetrics();
    expect(output).toContain('process_cpu_seconds_total');
    expect(output).toContain('process_resident_memory_bytes');
  });

  it('should count and time recorded requests', async () => {
    metricsService.recordRequest('GET', '/health', 200, 0.02);
    metricsService.recordRequest('POST', '/upload', 500, 0.3);

    const output = await metricsService.getMetrics();
    expect(output).toContain('http_requests_total{method="GET",route="/health",status_code="200"} 1');
    expect(output).toContain('http_requests_total{method="POST",route="/upload",status_code="500"} 1');
    expect(output).toContain(
      'http_request_duration_seconds_bucket{le="0.025",method="GET",route="/health",status_code="200"} 1',
    );
  });
});
