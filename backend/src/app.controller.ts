import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { DatabaseService } from './database.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Liveness: the process is up and serving requests
  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  // Readiness: the backend can actually serve uploads (database reachable)
  @Get('health/ready')
  async getReadiness(): Promise<{ status: string; database: string }> {
    if (!(await this.db.isHealthy())) {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
