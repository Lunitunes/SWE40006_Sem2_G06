import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // Use the route template (e.g. /upload/image/:id), not the raw URL, to keep label cardinality low
    const route = (req.baseUrl ?? '') + (req.route?.path ?? req.path);
    if (route === '/metrics') return next.handle();

    const start = process.hrtime.bigint();
    // 'finish' fires after exception filters run, so errors are recorded with their real status code
    res.once('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metricsService.recordRequest(req.method, route, res.statusCode, durationSeconds);
    });

    return next.handle();
  }
}
